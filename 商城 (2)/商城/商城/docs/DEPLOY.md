# 部署指南

## 1. 准备工作

- 微信开发者工具（最新稳定版）
- 一个小程序的 AppID（个人订阅号也能申请测试号）
- 微信云开发环境（每个小程序账号可免费开通 2 个）

## 2. 导入项目

1. 打开**微信开发者工具**
2. 选择「导入项目」
3. 项目目录选择 `D:\商城`
4. AppID 选择「测试号」或填入你自己的 AppID
5. 后端服务选择「微信云开发」

## 3. 创建云开发环境

1. 开发者工具左上角点击「云开发」按钮
2. 同意协议，开通云开发
3. 创建一个新环境，记下 **环境 ID**（形如 `campus-1abcdef`）
4. 在 `app.js` 中替换：
   ```js
   wx.cloud.init({ env: 'your-env-id', traceUser: true });
   ```

## 4. 创建数据库集合

在云开发控制台 → 数据库，创建以下集合（**演示版也可跳过此步，首次写入数据时云开发会自动创建**）：

```
users / goods / orders / conversations / messages /
favorites / reports / reviews / categories / pickup_points / schools
```

> `schools` 是可选的：学校清单优先读这个集合，读不到会回落到 `school` 云函数内置的默认清单，
> 所以即使不建这个集合也不会出现"选不了学校"。

## 5. 部署云函数

依次在「云开发 → 云函数」中创建并上传：

| 云函数名 | 入口 | 说明 |
| --- | --- | --- |
| login | cloudfunctions/login | 登录与初始化用户 |
| goods | cloudfunctions/goods | 商品 CRUD |
| order | cloudfunctions/order | 订单状态机 |
| chat | cloudfunctions/chat | 会话与消息 |
| user | cloudfunctions/user | 资料 / 认证 / 收藏 / 评价 / 举报 |
| admin | cloudfunctions/admin | 管理后台 |
| **school** | cloudfunctions/school | **学校清单与自提点下发（多校隔离数据源）** |

**注意：上传时勾选「上传并部署：云端安装依赖」**，否则会因缺少 `wx-server-sdk` 报错。

> `school` 是新增的云函数，**漏部署会导致学校列表为空 → 无法发布商品、无法下单**。
> 前端 `utils/school.js` 有内置兜底清单，所以即使没部署也能跑，但只会显示内置的示例学校。

## 6. 初始化数据

打开小程序（在开发者工具中点击「编译」），打开「我的」→「管理后台」（首次会提示「无管理员权限」，需要先在数据库手动把自己的用户 `isAdmin` 设为 `true`）。

更简单的方式：直接用开发者工具的「云开发 → 云函数 → admin → 测试」，传参：
```json
{ "action": "init" }
```
该接口会：
1. 写入 10 个分类 + 4 个自提点
2. 若全无管理员，将**调用者**设为管理员

## 7. 体验流程

1. 打开「我的」→「学生认证」，随便填写（演示版不会真正审核，但前端会显示「已通过」）
2. 「发布」上传图片、填价格、选分类 → 提交
3. 在首页/分类看到自己的商品
4. 用另一个微信扫码进入（演示版会创建新用户），在商品详情点「私聊」发起对话
5. 「立即购买」提交订单，回到卖家身份点「接受」并「完成」

## 8. 常见问题

### Q: 真机调试报 "wx.cloud is not a function"
A: 用户微信版本过低，提示升级。或确认 `app.js` 中先 `wx.cloud.init()` 再调用其他云函数。

### Q: 发布商品上传图片失败
A: 检查云存储是否开通（云开发 → 存储）。当前 `goods` 云函数上传路径为 `goods/<openid>/<timestamp>.jpg`。

### Q: 第一次进来没有分类？
A: 跑一遍 `admin` 云函数的 `init` action 即可。

### Q: 学校列表是空的 / 提示"请先选择学校" / 发布商品失败？
A: 按顺序排查：
1. `school` 云函数是否已上传部署（这是最常见的漏部署项）
2. 若已部署仍为空，前端会自动使用内置兜底清单，此时应能看到「示例大学」
3. 想换成真实学校，在 `schools` 集合里加文档即可，无需改代码：
   ```json
   { "name": "XX大学", "sort": 1, "pickupPoints": [{ "name": "北门驿站", "desc": "靠近地铁" }] }
   ```
4. 也可以直接改 `cloudfunctions/school/index.js` 顶部的 `DEFAULT_SCHOOLS`（改完需重新部署）

### Q: 自提点在哪里配置？
A: 两个来源，后者优先：
- `schools` 集合里每所学校的 `pickupPoints` 数组
- `pickup_points` 集合（按 `campus` 字段归并到对应学校）
  ```json
  { "name": "图书馆一楼", "desc": "工作日 8:00-22:00", "campus": "XX大学" }
  ```

### Q: 想换主题色？
A: 改 `app.wxss` 顶部的 CSS 变量（`--primary` 等），全站统一变化。

### Q: 怎么加管理员？
A: 改 `users` 集合，把对应用户的 `isAdmin` 字段设为 `true`。

### Q: 聊天是轮询吗？能不能用 WebSocket？
A: 演示版用 5s 轮询。生产可改 [云函数 WebSocket](https://developers.weixin.qq.com/miniprogram/dev/wxcloud/guide/websocket.html) 或在 `chat` 云函数中加定时触发器，主动推送订阅消息。

## 9. 生产化 checklist

- [ ] 替换 `app.js` 中的 env ID
- [ ] 配置合法域名（小程序后台 → 开发管理）
- [ ] 设置云函数超时时间（聊天/上传建议 20s）
- [ ] 数据库自定义安全规则
- [ ] 敏感词过滤（举报原因、商品标题、聊天内容）
- [ ] 用户协议 + 隐私政策（发布协议、聊天规范）
- [ ] 接入内容安全 API（[imgSecCheck](https://developers.weixin.qq.com/miniprogram/dev/api-backend/open-api/sec-check/security.imgSecCheck.html) / [msgSecCheck](https://developers.weixin.qq.com/miniprogram/dev/api-backend/open-api/sec-check/security.msgSecCheck.html)）
- [ ] 校园邮箱验证（演示版跳过，生产可发邮件验证 token）
- [ ] 备份策略（云开发控制台 → 数据库 → 数据导出）
