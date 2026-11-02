# 校园集市 · 项目长期约定

> 详细展开见 `docs/开发约定.md`（本文只留每次会话都必须知道的核心）。

## 基本信息
微信小程序（云开发），环境 `cloud1-d6gxmdbcqf5d51f3e`，根目录 `D:\商城`。
云函数 9 个：`login / user / goods / chat / order / admin / school / feedback / seccheck`。页面 26 个，组件 3 个（`goods-card / nav-bar / empty`）。

## 设计系统（改样式前必读）
**手绘贴纸风**，全部走 `app.wxss` 的 `page{}` CSS 变量：

| 变量 | 值 | 用途 |
|---|---|---|
| `--ink` / `--ink-2` / `--ink-3` | `#3D2B1F` / `#8A6F55` / `#B39B80` | 描边色+主文字 / 次 / 三级文字 |
| `--bg` / `--card` / `--line` | `#FFF9EE` / `#FFFFFF` / `#E8DCC6` | 奶油底 / 卡片 / 暖色分隔线 |
| `--primary` / `-light` / `-dark` | `#E8542F` / `#FFE3D6` / `#C8421F` | 珊瑚橙，**只用于价格/主按钮/选中态** |
| `--radius` / `--shadow` | `20rpx` / **`none`** | **本风格不用阴影** |

手法：① **描边代替阴影**（卡片 `4rpx` 深棕描边，右下加粗 `8rpx` 做"翘边"）；② 点缀色收敛；③ **不用渐变**（极淡白色径向高光做笔触质感属于有意例外，非装饰彩渐变）。
写死颜色时沿用色板：暖灰 `#F5EADA`/`#F0E4D0`、描边灰 `#E8DCC6`/`#D8C6AA`。
换肤脚本 `tools/apply_theme_sticker.js`。导航栏统一 `components/nav-bar`（21 页复用）；自定义 tabBar 在 `custom-tab-bar/`（每格 pastel 气泡底色由 `index.js` 的 `bg` 字段注入，已实测图标色后选配，避开棕/奶油/珊瑚橙）。

## 分类体系（改动前必读）
**唯一数据源 = `utils/categories.js`**（2026-09-17 建立）。**新增/改分类只改这一个文件**，再跑 `node scripts/check-category-sync.js` 校验 key/图标/素材四方一致。
- 中文名 `catName(key)` / 图标 `catIcon(key)` emoji `catEmoji(key)` / 对象 `catOf(key)`（非法兜底「其他闲置」）/ 筛选列表 `catOptions(label)` / 合法 `isCatKey(key)` / 全量 `CATEGORY_KEYS`。
- **禁止** `CATEGORIES.find(c => c.key === key).name`（`tools/check_category_logic.js` 第 3 组查重）。空串 `''` = 全部分类（非合法 key）。
- 服务端展示名统一下发 `categoryText`（`goods.decorate`/`admin.listGoods`），前端优先 `item.categoryText` 本地 `catName()` 兜底。
- ⚠️ 云函数部署只打包本目录、无法 require 小程序端模块 → `goods`/`admin` 各内联一份 `CATEGORY_MAP`；`check_category_logic.js` 第 6 组校验三处一致，**改分类务必同步这三处**。
- ⚠️ 发/改商品 category 走白名单校验（`goods.publish`/`update`），否则脏 key 静默入库 → 分类页搜不到 + 后台无法归类。
- ⚠️ 库里 `categories` 集合是「只写不读」死数据；硬编码 `utils/categories.js` 才是生效源。待决策：A 硬编码 / B 读库 / C 硬编码+删死数据（推荐起步）。

## 云开发查询坑（踩过必看）
- ⚠️⚠️ **「或」条件绝不能赋值给字段** —— 必须提到**顶层** `_.and([where, _.or([...])])`（已踩三次：type 过滤/campus 多校隔离/myGoods·myFavs，均静默忽略不报错返回多余数据）。字段只用值型：`_.eq/_.neq/_.in/_.gte/_.lte/_.exists`；单字段排除优先 `_.neq()`。
- ⚠️ **验证 `_.or` 必须临时插一条异值数据做对照**（`tools/verify_campus_isolation.js` 模式），否则现状「全是同值」测不出失效。
- ⚠️ **`call()` 返回值没有 `code`**：成功 resolve `res.result.data`，失败 reject。页面统一 `try/catch` 包 `await call(...)`，不要写 `if (r.code !== 0)`。
- ⚠️ **`count()` 不能与 `_.in()` 聚合**（静默把同数返回每个 id）；分组统计 `field({_openid,status}).limit(1000).get()` 后内存 reduce。
- ⚠️ **`_.in(['',null])` 匹配不到「字段不存在」** → 老数据兼容显式加 `_.exists(false)`。
- ⚠️ **`.limit()` 上限**：客户端 100 / 云函数 1000，超了静默截断。
- 集合不存在抛 `-502005` → 读用 `readSafe`、写用 `ensureAdd`（均在 `cloudfunctions/admin`）。

## 关键业务约定
- **审核流**：发布 → `pending`（仅「我的商品·审核中」可见）→ 后台通过 → `onSale`；驳回 → `off` + `offType:'reviewReject'`。
- 状态全集 `pending/onSale/sold/reserved/off/banned`（`banned`=禁售）；文案 `utils/util.js` 的 `STATUS_GOODS`。
- 下架/禁售一律「状态化」不硬删，`offType` 记来源：`self/report/admin/ban/imgRisk/reviewReject`。
- **二次审核队列**：管理员/举报/禁售/违规导致的移除置 `recheck=true`；自主下架为 false。`admin.recheckGoods({id,decision})`：`onSale`/`off`/`banned`，出队写 `admin_logs`。
- **首页快速刷新（双层）**：① 云函数跨调 `goods.markDirty` 破服务端 10s 缓存；② 页面 `wx.setStorageSync('cm_home_dirty', Date.now())` 破客户端 60s SWR（首页 `onShow` 消费并清除）。
- **求购（want）**：图片/价格选填，`condition` 强制 `normal`，无图 `imgCheckStatus='safe'`；文案 `STATUS_WANT`，统一 `goodsStatusText(item)` 按 type 选表；求购无成色（`condText` 置空）；无图详情 `.hero-want` 占位（不渲染 swiper）；卡片 `.gc-noimg`（`noCover`，别复用默认图）。列表分流：出售 `type: _.neq('want')`，求购 `type: 'want'`。
- ⚠️ **脏数据防护**：历史 `offReason` 混入表单占位语（`请填写下架原因…`），展示前过 `cleanReason()`（`/^请填写|^请输入|选填|留空则/` 或长度>60 无效），已在 `admin-goods.js`/`sold.js`/`detail.js` 三处统一。

## 图片链路
`<image>` 无法渲染 `cloud://`，须服务端换 https；临时链接**仅 10 分钟**有效，缓存 TTL < 6 分钟；大图 `imageMogr2` 缩放（**必须 `&` 追加**，用 `?` 签名失效）。所有 `<image>` 都要 `binderror` 兜底；**清失败标记必须同时改 `src`**，否则永久空白。

## 部署云函数（改完必做）
```
cli.bat cloud functions deploy --env cloud1-d6gxmdbcqf5d51f3e --names <fn...> --project "D:/商城" --remote-npm-install
```
`--project` 必须 Windows 路径（传 `/d/商城` 报 `code 10`）；`--names` 空格分隔（逗号失败）；无本地 `node_modules` 必须 `--remote-npm-install`。

## 云函数健壮性约定
- **批量删除/更新并行分批**：`admin/index.js` 的 `removeAllBy(collection, where)`（每批 100 `Promise.all` + 循环 + `MAX_LOOPS`）；**禁止** `for...await doc.remove()`（clearUser 最坏 1200 条必 `-504003` 且删一半中断）。
- **循环内不要 `await`** → `Promise.all`（可配并发上限）；外部调用（downloadFile/第三方，2~3s）必须限数量上限。
- **巡检类接口服务端节流**：进程内时间锁（`order.checkTimeout` 60s 复用并返 `throttled:true`）。
- **返回前端用户数据走白名单投影**（`user/index.js` 的 `projectSelf`）：绝不 `return ok(文档)`。`verifyApply.evidence` 证件原图前端零读取须剥离；商品列表 `delete _openid`。`studentId`/`isAdmin`/`_openid` 有 UI 依赖，删前查前端。
- ⚠️⚠️ **状态流转必须「条件更新 + 校验 `stats.updated === 1`」**，禁止「先 get 校验→无条件 update」（并发双写）。释放商品回在售须带 `status:'reserved'`，否则复活已下架/禁售商品。
- **计数改「实时统计回写」而非 `_.inc`**（`user.toggleFav/toggleWant`）：`_.inc` 一次失败永久漂移；记录用**确定性 `_id`**（`openid_goodsId`）幂等。
- 管理端搜索必须 DB 层过滤；`setAdmin` 限白名单；内部动作 `markDirty` 有 OPENID 就要求管理员鉴权，`pendingImgCheck` 派发处禁客户端调用。
- ⚠️ **`ensureSet(collection, id, data)` 内部必须 `delete d._id` 再 `doc(id).set()`**（cloud 禁止 data 带 `_id`，否则 `-501007` 致 500）。chat/user/goods 三处须一致（上轮漏改 user/goods 致收藏/想要全 500）。

## 前端通用约定
- 图片上传统一 `utils/upload.js` 的 `chooseAndUpload({dir, remain})`。
- 时间格式化统一 `utils/util.js` 的 `formatTime`。
- 图片兜底：服务端图 `binderror`；列表 `imgErr` 映射，单个布尔 `xxxErr`。加 `binderror` 必须同时在 JS 定义 handler（漏写不报错、兜底静默失效），改完跑 `tools/check_handlers.js`。
- ⚠️ **WXML 复杂布尔表达式（`!==` 混 `&&` 混 `>`）不按预期求值** → 显示条件一律在 JS（observers）算成布尔，WXML 只写 `wx:if="{{showX}}"`（商品卡片「想要」热度踩过）。

## 管理后台（4 页）信息架构
统一「**一张卡 = 一条记录**」6 层：① 身份行 ② 属性行 ③ 关联行 ④ 问题区块 `.issue`（仅异常渲染）⑤ 页脚计数 ⑥ 操作区。整卡 `bindtap="goDetail"`，卡内按钮/缩略图 `catchtap`（防冒泡）。跳转同小程序端（商品 `/pages/detail/detail?id=`；用户 `/pages/sold/sold?openid=`）。`offType` 缺失老数据显示「已下架（历史数据）」勿留空。

## tools/ 目录约定
**临时产物用 `_` 前缀、用完即删；常驻工具不加前缀。** 常驻：`check_handlers`/`check_one_page`/`test_all_pages`(26 页巡检)/`run_all_features`(47 接口)/`test_my_changes`/`verify_campus_isolation`/`verify_hardening`/`apply_theme_sticker`/`check_category_logic`(分类改动后必跑)。

## 真机自动化测试（详见技能 wechat-mp-live-verify；此处只留易忘点）
连接：`cli.bat auto --project "D:\商城" --auto-port 9420`（`ws://localhost:9420`）。**必避**：
1. 不调 `mp.close()`（断端口）；2. `mp.screenshot()` 重置页面栈 → **截图放最后**；3. 同进程多导航进陈旧态 → 一页一进程；4. 长任务不接 `| tail/grep` 管道；5. 写操作看状态不看响应码（`-404006`=响应丢失多半已成功）；6. 详情 `item` 断言给 ≥10s；7. `reLaunch/navigateTo` 到 tabBar 页不可靠 → 用 `switchTab` 或点 `.tab-item`，且**每步断言 route**；8. `callMethod` 嵌套参数被序列化丢弃 → 点真实元素；9. 孤儿端口先 `netstat -ano | findstr 9420` + `taskkill /F /PID`；10. 连跑约 3 次 IDE 进不可恢复态 → 改用静态校验+手动截图；11. 截图后页面栈回首页，后续测量须在首页 DOM 上 → 测量同时量 `getCurrentPages().slice(-1)[0].route` 自校验；12. 一次运行内不要 disconnect 后重连（分独立进程）。
⚠️ **截图 tabBar 前必须确认路由是 tab 页**：若项目停在普通页，截到的底部全是奶油底、tabBar 不出现，会误判"样式没生效"（本次 2026-09-18 踩：先用 `getCurrentPages()` 确认 `pages/index/index` 再截图）。
**推荐策略**：真机不适合做每次回归（环境不稳耗时）；日常用静态逻辑校验（纯 Node 秒级），视觉/交互改动才补跑真机。

## 环境注意事项（Windows / Git-Bash）
- ⚠️ Git-Bash 调 Windows 原生命令加 `MSYS_NO_PATHCONV=1`：`MSYS_NO_PATHCONV=1 taskkill /F /IM WeChatAppEx.exe`。
- ⚠️ `wmic` 被安全策略拉黑，进程信息用 `tasklist`。
- PowerShell 工具本会话不返回 stdout，排查用 Bash + cmd 原生命令。
- 模型读不了图片（Read 被过滤）→ 配色/对比验证用 Pillow 解析 PNG 像素 + 截图像素计数（见技能"模型无法看图时"一节）。
