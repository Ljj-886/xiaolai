# 校园集市 · 校园二手交易平台（Campus Market）

面向在校大学生的 C2C 校园二手物品交易微信小程序，配套可脱离云环境运行的 Spring Boot 后端（mall-server）。覆盖商品发布、首页推荐与搜索、分类检索、商品详情、下单交易、自提点线下交割、买卖双方私信、收藏与想要、订单完成与评价、信用分、违规举报、内容安全审核及后台管理等完整闭环。

## ✨ 功能模块

**商品发布与展示**
- 商品发布 / 编辑 / 下架，多图上传落盘 `uploads/`，经 `GET /files/**` 访问
- 首页推荐、分类检索、关键词搜索，商品经内容安全校验后上架

**交易与订单**
- 买家下单，订单按「待接单 → 待见面 → 已完成」状态机流转
- 结合自提点（pickup_points）线下交割，订单更新采用条件更新防并发双写

**即时沟通**
- 基于会话（conversations）与消息（messages）实现买卖双方私信
- 聊天页内嵌商品卡片可直接跳转详情，支持消息列表与未读管理

**用户与信用**
- 用户资料（users）、收藏（favorites）、想要（wants）、校园认证（verify）与信用分
- 多校区数据通过 `campus` 字段隔离，不同学校数据互不可见

**安全审核与后台**
- 文本/图片双重内容安全校验（微信 secCheck + 本地敏感词库）
- 举报（reports）、评价（reviews）、反馈（feedback）闭环
- 后台（admin）提供商品/用户/审核/统计管理，操作留痕至 admin_logs

## 🛠️ 技术栈

- 前端：微信小程序原生（WXML / WXSS / JS）、自定义 tabBar、统一调用网关（USE_LOCAL 开关）
- 后端：Spring Boot 3.3.1 · Java 17（运行于 JDK 21）· MyBatis-Plus 3.5.7
- 数据库：MySQL 5.7 · Connector/J 5.1.49 · Lombok
- 接口：`POST /api/{domain}` + body `{action}`，统一响应信封 `{code, msg, data}`，端口 9090

## 🚀 快速开始

1. 数据库：安装 MySQL 5.7，用 Navicat 或命令行执行 `files/campus_market_导入脚本.sql`，建立 `campus_market` 库（账号 `root/root`，端口 3306）；
2. 后端：IDEA 打开 `mall-server/`，运行 `MallServerApplication`；或 `mvn package` 后 `java -jar target/mall-server-1.0.0.jar`（端口 9090）；
3. 前端：微信开发者工具导入 `商城 (2)/商城`，默认 `utils/cloud.js` 中 `USE_LOCAL = true` 走本地 9090，编译即可预览。

## 📁 目录结构

```
一整套校园贩卖二手平台/
├── README.md
├── .gitignore
├── files/
│   └── campus_market_导入脚本.sql      # 建库 + 14 张表 + 种子数据
├── mall-server/                        # 后端（Spring Boot）
│   └── mall-server/
│       ├── src/                       # 50 个 Java 类、12 个 Controller
│       ├── db/campus_market_setup.sql
│       ├── pom.xml
│       └── seed.sql
└── 商城 (2)/商城/                      # 微信小程序前端（26 页面 / 11 utils / 3 组件）
    ├── pages/                         # index / category / detail / publish / chat / mine ...
    ├── components/                    # goods-card / nav-bar
    ├── utils/cloud.js                 # 统一调用网关（USE_LOCAL 适配器）
    └── project.config.json
```

## 说明

- 本仓库为校园二手交易平台，含微信小程序前端与 Spring Boot 后端，可脱离云环境本地运行；
- 本地联调默认 `USE_LOCAL=true` 走本地后端，无需开通微信云开发环境；
- 已通过 `.gitignore` 排除构建产物（`target/`）、运行时图片（`uploads/`）、IDE 配置（`.idea/`）、压缩包与第三方安装程序，仅保留可复现的源码与数据库脚本；
- 仓库地址：`https://github.com/Ljj-886/campus-market`（请替换为你的实际仓库名）。
