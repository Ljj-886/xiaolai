# 校园集市 · IDEA 后端（mall-server）

把微信小程序「校园集市」的核心后端，用 **Spring Boot 3.3.1 + Java 21 + MyBatis-Plus + MySQL** 重写出来的**可运行脚手架**。
数据库就是之前建的 `campus_market`（本机 3306，由 `../商城/docs/小程序MySQL表结构.sql` 生成）。

> 这是**参考实现/脚手架**：覆盖了用户、商品、订单、分类、私信五大主链路，
> 不是把小程序 9 个云函数 1:1 搬过来。需要哪个模块补全（审核流、举报、收藏、反馈、后台管理…）再继续加。

## 技术栈
- Spring Boot 3.3.1 / Java 21
- MyBatis-Plus 3.5.7（通用 Mapper + 条件构造器，省去 XML）
- MySQL Connector/J **5.1.49**（`com.mysql.jdbc.Driver`）→ 连 `127.0.0.1:3306/campus_market`
  ⚠️ 必须 5.1.49，8.x 驱动连 MySQL 5.0.45 会报 `CLIENT_PLUGIN_AUTH`
- Lombok

## 前置条件
- JDK 21
- MySQL 已建好 `campus_market` 库（14 张表）+ 示例数据（`seed.sql`）
- 连接账号：`root / 123456`（在 `src/main/resources/application.yml` 改）

## 在 IDEA 里运行
1. IDEA → Open → 选中本目录的 `pom.xml` → 以 Maven 项目打开
2. 右侧 Maven 面板 → Reload（自动下载依赖）
3. 找到 `com.campus.mall.MallServerApplication` → 右键 Run
4. 启动后访问：
   - `http://localhost:9090/api/categories` —— 分类列表（GET）
   - `http://localhost:9090/api/goods/list?campus=示例大学` —— 商品列表（GET）
   - IDEA 自带的 **Database** 工具：连 `127.0.0.1:3306 / campus_market / root / 123456` 即可直接看表、写 SQL

## 主要接口
| 方法 | 路径 | 说明 |
|---|---|---|
| GET  | `/api/goods/list` | 商品列表（支持 campus 多校隔离 / category / keyword 分页） |
| GET  | `/api/goods/{id}` | 商品详情 |
| POST | `/api/goods/publish` | 发布商品（body 为 Goods JSON） |
| POST | `/api/goods/{id}/status` | 状态流转（条件更新，防并发双写） |
| POST | `/api/orders/create` | 下单 |
| POST | `/api/orders/{id}/complete` | 完成订单（仅 meeting 态可完成） |
| GET  | `/api/user?openid=` | 查用户 |
| POST | `/api/user/upsert` | 登录/首次写入资料 |
| GET  | `/api/categories` | 分类列表 |
| GET  | `/api/conversations?openid=` | 我的会话 |
| POST | `/api/conversations/{convId}/messages` | 发私信 |
| GET  | `/api/messages?convId=` | 会话消息 |

## 和小程序的对应关系
- 小程序里 `call('goods',{action:'list'})` → 这里 `GET /api/goods/list`
- 小程序前端若要接这个后端，需要把 `utils/cloud.js` 的 `call()` 改成请求 `http://localhost:9090/api/...`（即替换掉云函数网关）
- 云库 JSON 字段 → 这里用 `LONGTEXT` + `String` 承载

## 说明
- 时间字段用 `BIGINT` 毫秒（与小程序 `Date.now()` 一致）
- `publish` 为演示方便直接置 `onSale`；小程序真实流程是 `pending → 后台审核 → onSale`
- 多校隔离、状态机、条件更新等已尽量对齐小程序的设计要点
