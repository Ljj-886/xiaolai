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

手法：① **描边代替阴影**（卡片 `4rpx` 深棕描边，右下加粗 `8rpx` 做"翘边"）；② 点缀色收敛；③ **不用渐变**。
写死颜色时沿用色板：暖灰 `#F5EADA`/`#F0E4D0`、描边灰 `#E8DCC6`/`#D8C6AA`。
换肤脚本 `tools/apply_theme_sticker.js`。导航栏统一 `components/nav-bar`（21 页复用）。

## 云开发查询坑（踩过必看）
- ⚠️⚠️ **「或」条件绝不能赋值给字段** —— 必须提到**顶层** `_.and([where, _.or([...])])`。
  **已踩过三次**（type 过滤 / campus 多校隔离 / myGoods·myFavs），每次都是**静默忽略、不报错、返回多余数据**。
  字段条件只用「值型」命令：`_.eq/_.neq/_.in/_.gte/_.lte/_.exists`。
  单字段排除类优先用 `_.neq()`（更简单且实测有效）。
- ⚠️ **验证 `_.or` 的方法论**：现有数据往往「全是同一取值」，**过滤失效与生效结果完全相同、测不出来**。
  必须**临时插一条异值数据**做对照（`tools/verify_campus_isolation.js` 即此模式：插异值→断言→自清理）。
  实例：goods 6 条本校 + 插 1 条外校 → 失效返回 7（含外校）、正确返回 6。
- ⚠️ **`call()` 返回值没有 `code`**：成功 resolve `res.result.data`，失败 **reject**。
  页面**不要写 `if (r.code !== 0)`**（恒为真），统一 `try/catch` 包 `await call(...)`。
- ⚠️ **`count()` 不能与 `_.in()` 聚合**：会把同一数字返回给每个 id（静默错误）。
  分组统计必须 `field({_openid,status}).limit(1000).get()` 后内存 reduce。
- ⚠️ **`_.in(['',null])` 匹配不到「字段不存在」** → 老数据兼容必须显式加 `_.exists(false)`。
- ⚠️ **`.limit()` 上限**：客户端 100 / 云函数 1000，**超了静默截断**。
- 集合不存在抛 `-502005` → **读用 `readSafe`、写用 `ensureAdd`**（均在 `cloudfunctions/admin`）。

## 关键业务约定
- **审核流**：发布 → `pending`（仅「我的商品·审核中」可见）→ 后台通过 → `onSale`；驳回 → `off` + `offType:'reviewReject'`。
- 状态全集 `pending/onSale/sold/reserved/off/banned`（**`banned`=禁售**）；文案在 `utils/util.js` 的 `STATUS_GOODS`。
- **下架/禁售一律「状态化」不硬删**，`offType` 记来源：`self/report/admin/ban/imgRisk/reviewReject`。
- **二次审核队列**：管理员/举报/禁售/违规导致的移除置 `recheck=true`；自主下架为 false。
  `admin.recheckGoods({id,decision})`：`onSale`/`off`/`banned`，出队并写 `admin_logs`。
- **首页快速刷新（双层，缺一都会等 10s/60s）**：① 云函数侧跨调 `goods.markDirty` 破服务端 10s 缓存；
  ② 页面侧 `wx.setStorageSync('cm_home_dirty', Date.now())` 破客户端 60s SWR 节流（首页 `onShow` 消费并清除）。
- **求购（want）**：图片/价格选填，`condition` 强制 `normal`，无图时 `imgCheckStatus='safe'`；
  状态文案走 `STATUS_WANT`（募集中/已达成/已关闭），统一用 `goodsStatusText(item)` 按 type 选表；
  求购**无成色概念**（`condText` 置空）；无图详情走 `.hero-want` 占位（**不渲染 swiper**，否则 `1/0`+白块），
  卡片走 `.gc-noimg`（`noCover` 标志，**别复用默认图**，像裂图）。
  列表分流：出售 `type: _.neq('want')`，求购 `type: 'want'`。
- ⚠️ **脏数据防护**：历史 `offReason` 混入过表单占位语（`请填写下架原因…`）。
  展示前一律过 `cleanReason()`（`/^请填写|^请输入|选填|留空则/` 或长度 > 60 视为无效），已在
  `admin-goods.js`/`sold.js`/`detail.js` 三处统一。

## 图片链路
`<image>` 无法渲染 `cloud://`，必须由服务端换 https；临时链接**仅 10 分钟**有效，一切缓存 TTL < 6 分钟；
大图用 `imageMogr2` 缩放（**必须 `&` 追加**，用 `?` 会签名失效）。
所有 `<image>` 都要有 `binderror` 兜底；**清「失败标记」时必须同时改 `src`**，否则永久空白。

## 部署云函数（改完必做）
```
cli.bat cloud functions deploy --env cloud1-d6gxmdbcqf5d51f3e --names <fn...> --project "D:/商城" --remote-npm-install
```
**`--project` 必须 Windows 路径**（传 `/d/商城` 报 `code 10`）；`--names` 用空格分隔（逗号会失败）；
无本地 `node_modules` 必须 `--remote-npm-install`。

## 云函数健壮性约定
- **批量删除/更新一律并行分批**：用 `admin/index.js` 的 `removeAllBy(collection, where)`
  （每批 100 条 `Promise.all` + 循环 + `MAX_LOOPS` 安全阀）。
  **禁止** `for (const x of list) await doc.remove()` —— 串行时 clearUser 最坏 1200 条必触 `-504003`，
  且**删到一半中断**（比不删更糟）。
- **循环内不要 `await`** → 用 `Promise.all`（可配并发上限）。有外部调用的（downloadFile/第三方 API，单次 2~3s）
  **必须限数量上限**，否则传 100 个必然超时。
- **客户端触发的「巡检类」接口必须服务端节流**（客户端节流可绕过）：进程内时间锁，
  见 `order.checkTimeout`（60s 内复用上次结果并返 `throttled:true`）。
- **返回前端的用户数据走白名单投影**（`user/index.js` 的 `projectSelf`）：**绝不 `return ok(文档)`**。
  `verifyApply.evidence`（证件原图）前端零读取、必须剥离；商品列表 `delete _openid`（可构造 chat convId）。
  `studentId`/`isAdmin`/`_openid` **有 UI 依赖**，删前先查前端用法。
- ⚠️⚠️ **状态流转必须「条件更新 + 校验 `stats.updated === 1`」**，禁止「先 get 校验 → 无条件 update」
  （并发下都读到旧状态 → **双写**）。已修 `order.create`（超卖）/ `complete`（计数 +2）/ `*Cancel` / `sellerConfirm`。
  释放商品回在售必须带 `status:'reserved'` 条件，否则会复活已被下架/禁售的商品。详见 `docs/开发约定.md`。
- **计数改「实时统计回写」而非 `_.inc` 累加**（`user` 的 `toggleFav/toggleWant`）：`_.inc` 一次失败就永久漂移；
  记录同时用**确定性 `_id`**（`openid_goodsId`）让重复写入幂等。
- **管理端搜索必须 DB 层过滤**（原「取 20 条 → 内存 filter」只搜当前页）；`setAdmin` 限白名单（防权限扩散）；
  内部动作（`markDirty`）用「有 OPENID 就要求管理员」鉴权，`pendingImgCheck` 在派发处禁客户端调用。

## 前端通用约定
- **图片上传统一走 `utils/upload.js` 的 `chooseAndUpload({dir, remain})`**，不在各页重写。
- **时间格式化统一 `utils/util.js` 的 `formatTime`**（后台三页曾各写一份 `fmtTime`）。
- **图片兜底**：服务端图片必须有 `binderror`；列表用 `imgErr` 映射，单个用布尔 `xxxErr`。
  本地图标 / `chooseMedia` 预览路径不需要兜底。
- ⚠️ **加 `binderror` 必须同时在 JS 定义 handler** —— 漏写**不报错、兜底静默失效**。
  改完跑 `tools/check_handlers.js` 核对。

## 管理后台（4 页）信息架构
统一「**一张卡 = 一条记录**」，固定 6 层：① 身份行 ② 属性行 ③ 关联行 ④ **问题区块 `.issue`**（**仅异常时渲染**）
⑤ 页脚计数 ⑥ 操作区。**可点击手法**：整卡 `bindtap="goDetail"`，卡内按钮/缩略图改 `catchtap`（防冒泡）。
跳转与小程序端一致（商品 → `/pages/detail/detail?id=`；用户 → `/pages/sold/sold?openid=`）。
`offType` 缺失的老数据 → 来源显示「已下架（历史数据）」，**不要留空**。详见 `docs/开发约定.md`。

## tools/ 目录约定
**临时产物用 `_` 前缀、用完即删；常驻工具不加前缀。**
清理：`cd tools && rm -rf _*.png _*.js _*.txt _button_backup`；删前先备份 `cp -r tools/_* .workbuddy/trash/<date>/`。
常驻工具：`check_handlers`(事件绑定校验) / `check_one_page`(单页渲染) / `test_all_pages`(26 页巡检) /
`run_all_features`(47 接口) / `test_my_changes`(逐项验证) / `verify_campus_isolation`(多校隔离) /
`verify_hardening`(脱敏+限流) / `apply_theme_sticker`(换肤)。

## 真机自动化测试
连接：`cli.bat auto --project "D:\商城" --auto-port 9420`（`wsEndpoint` 用 `ws://localhost:9420`，`127.0.0.1` 连不上）。
**必避的坑**：
1. 脚本**不要调 `mp.close()`** —— 会断开端口，后续用例全部连不上；
2. `mp.screenshot()` 会重置页面栈 → **截图放所有断言之后**；
3. 同进程导航过多会进陈旧状态（报 `rawPath`）→ **分段跑**；一条命令**只跑一页** check_one_page（连跑会挂）；
4. 不要用 `| tail` / `| grep` 包长任务（管道缓冲）→ 改 `> tools/_r_xxx.txt 2>&1` 后另起命令 `cat`；
5. 写操作成败**看状态不看响应码**（`-404006` = 响应丢失，函数多半已成功）；
6. 断言详情页 `item` 非空要给 ≥10s（5s 会误判 FAIL，只是异步未回）。
