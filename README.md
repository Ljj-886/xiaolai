# 校园集市 · 校园二手交易平台（Campus Market）

面向在校大学生的 C2C 校园二手物品交易微信小程序，配套可脱离云环境运行的 Spring Boot 后端（mall-server）。覆盖商品发布、首页推荐与搜索、分类检索、商品详情、下单交易、自提点线下交割、买卖双方私信、收藏与想要、订单完成与评价、信用分、违规举报、内容安全审核及后台管理等完整闭环。

## 技术栈

| 层 | 技术 |
| --- | --- |
| 前端 | 微信小程序原生框架（WXML / WXSS / JS）、自定义 tabBar、统一调用网关（USE_LOCAL 开关） |
| 后端 | Spring Boot 3.3.1、Java 17（运行于 JDK 21）、MyBatis-Plus 3.5.7、MySQL Connector/J 5.1.49、Lombok |
| 数据库 | MySQL 5.7，`campus_market` 库，14 张表，端口 3306 |
| 接口 | `POST /api/{domain}` + body `{action}`，统一响应信封 `{code, msg, data}`，后端默认端口 9090 |

> 前端通过 `utils/cloud.js` 的 `USE_LOCAL` 开关切换：**`true`** 走本地 Spring Boot 后端（默认）；`false` 恢复微信云开发（`wx.cloud.callFunction`）。本地模式业务代码零改动。

## 目录结构

```
一整套校园贩卖二手平台/
├── README.md
├── .gitignore
├── files/                          # 资料与数据库脚本
│   └── campus_market_导入脚本.sql   # 建库 + 14 张表 + 种子数据
├── mall-server/                    # 后端（Spring Boot）
│   ├── mall-server/
│   │   ├── src/                    # 50 个 Java 类、12 个 Controller
│   │   ├── db/campus_market_setup.sql
│   │   ├── pom.xml
│   │   └── seed.sql
│   └── README.md
└── 商城 (2)/商城/                  # 微信小程序前端（26 页面 / 11 utils / 3 组件）
    ├── pages/                      # index / category / detail / publish / chat / mine ...
    ├── components/                 # goods-card / nav-bar
    └── utils/cloud.js              # 统一调用网关（USE_LOCAL 适配器）
```

## 运行环境搭建

### 1. 数据库
- 安装 MySQL 5.7，确保端口 3306 可用；
- 用 Navicat 或命令行执行 `files/campus_market_导入脚本.sql`，建立 `campus_market` 库（含 14 张表与示例数据）；
- 连接账号：`root / root`。

### 2. 后端（mall-server，端口 9090）
方式一（IDEA）：直接打开 `mall-server/` 运行 `MallServerApplication`；
方式二（命令行）：
```bash
cd mall-server/mall-server
mvn -q package -DskipTests
java -jar target/mall-server-1.0.0.jar
```
启动后接口地址：`http://localhost:9090/api/{domain}`。

### 3. 前端（微信小程序）
- 微信开发者工具「导入项目」，目录选择 `商城 (2)/商城`；
- 默认 `utils/cloud.js` 中 `USE_LOCAL = true`，请求走本地 `http://127.0.0.1:9090`；
- 编译即可在模拟器查看，本地联调无需开通云开发环境。

## 核心功能模块

首页推荐 · 分类检索 · 商品发布与详情 · 搜索 · 下单与订单 · 私信会话 · 收藏/想要 · 个人中心 · 信誉分 · 举报反馈 · 后台管理（商品/用户/审核/统计）

## 设计要点

- **多校区数据隔离**：`campus` 字段隔离不同学校数据；
- **商品状态机**：`pending → onSale → sold / off`；
- **订单条件更新**：防并发双写；
- **双重内容安全校验**：微信 secCheck + 本地敏感词库（文本/图片）；
- **自提点线下交割**：结合 `pickup_points` 表；
- **统一调用网关**：本地 REST / 云开发双模式一键切换。

## 说明

- 仓库已通过 `.gitignore` 排除构建产物（`target/`）、运行时图片（`uploads/`）、IDE 配置（`.idea/`）、压缩包与第三方安装程序，仅保留可复现的源码与数据库脚本。
- 本地联调默认使用演示数据；正式部署请将 `utils/cloud.js` 中的地址改为服务器域名，并将图片存储迁移至对象存储（COS/OSS）。
