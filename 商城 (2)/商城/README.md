# 校园集市小程序

一个面向大学生的校园闲置物品信息共享微信小程序。基于微信原生 + 微信云开发（CloudBase），免运维、零服务器，扫码即可上手。

## ✨ 功能

| 模块 | 能力 |
| --- | --- |
| 商品 | 发布、9 图上传、分类筛选、价格区间、关键字搜索、最新/价低/价高/热门排序、详情、收藏 |
| 校园身份 | 学号 + 校园邮箱认证、校园徽章、信用分 |
| 预约 | 提交预约、卖家确认、约定自提时间与地点、完成自提、互评打分与标签 |
| 沟通 | 基于商品粒度的站内聊天（自动按 goodsId 隔离）、未读消息 |
| 治理 | 举报（虚假、违禁、欺诈等）、管理员后台（举报处理、商品下架、用户封禁、统计） |
| 个人中心 | 我的发布/在售/已售/收藏/订单/编辑资料 |

## 🧱 技术栈

- **前端**：微信原生小程序（WXML + WXSS + JS）
- **后端**：微信云开发（云函数 + 云数据库 + 云存储）
- **设计**：自绘（纯 Python 生成 81×81 tabBar 图标，4× 超采样抗锯齿），主色 `#FF6B35`

## 📁 目录结构

```
商城/
├── app.js / app.json / app.wxss      # 全局配置与样式
├── project.config.json               # 小程序项目配置
├── sitemap.json
├── images/                           # tabBar 图标
├── components/
│   ├── goods-card/                   # 商品卡片
│   └── empty/                        # 空状态
├── pages/                            # 18 个页面
│   ├── index/                        # 首页信息流
│   ├── category/                     # 分类
│   ├── search/                       # 搜索
│   ├── detail/                       # 商品详情
│   ├── publish/                      # 发布商品
│   ├── chat/                         # 会话列表
│   ├── chatroom/                     # 聊天详情
│   ├── order/                        # 预约列表 + 提交预约
│   ├── order-detail/                 # 订单详情
│   ├── review/                       # 评价
│   ├── favorite/                     # 收藏
│   ├── sold/                         # 我发布 / 卖家主页
│   ├── verify/                       # 学生认证
│   ├── pickup/                       # 自提点选择
│   ├── report/                       # 举报
│   ├── admin/                        # 管理后台
│   ├── edit-profile/                 # 编辑资料
│   └── mine/                         # 我的
├── utils/
│   ├── cloud.js                      # 云函数统一封装
│   ├── util.js                       # 工具方法（时间、价格、订单号等）
│   └── constants.js                  # 分类、成色、举报原因等常量
├── cloudfunctions/                   # 7 个云函数
│   ├── login/                        # 登录初始化用户
│   ├── goods/                        # 商品 CRUD
│   ├── order/                        # 订单状态机
│   ├── chat/                         # 聊天会话与消息
│   ├── user/                         # 用户资料 / 认证 / 收藏 / 评价 / 举报
│   ├── school/                       # 学校清单与自提点下发（内置兜底 + 数据库可覆盖）
│   └── admin/                        # 初始化 / 举报处理 / 统计
├── tools/
│   └── gen_icons.py                  # 生成 tabBar 图标（可重跑）
├── docs/
│   ├── DATABASE.md                   # 数据库设计
│   └── DEPLOY.md                     # 部署指南
└── README.md
```

## 🚀 快速开始

> 详细部署与数据库配置见 [docs/DEPLOY.md](./docs/DEPLOY.md)

1. 克隆/下载本项目到本地
2. 打开**微信开发者工具**，导入 `D:\商城` 目录
3. 在「微信云开发」创建新环境，把环境 ID 填到 `app.js` 的 `wx.cloud.init({ env: 'your-env-id' })`
4. 在云开发控制台创建以下 6 个数据库集合（权限设为「仅创建者可读写」或按需调整）：
   - `users` / `goods` / `orders` / `conversations` / `messages` / `favorites` / `reports` / `categories` / `pickup_points` / `reviews`
5. 在云开发 → 云函数 → 上传并部署：依次部署 `login / goods / order / chat / user / school / admin` 七个云函数（**`school` 千万别漏，漏了会选不了学校，进而无法发布和提交预约**）
6. 打开小程序，第一次进入会调用 `admin` 的 `init` 写入分类和自提点，并把当前用户设为管理员
7. 在「我的」→「管理后台」可处理举报、查看统计

> **首次体验**：完成上述步骤后，在「我的」→「学生认证」随便填资料（演示版不会真正审核），再回到「发布」即可上架第一件商品。

## 🔑 设计要点

### 同校自提

校园二手最大的信任问题是「跨校/陌生人线下自提」。本项目做了几件事：
- 必填「自提点」字段，发布时在校园内常见位置（北门、图书馆、宿舍区等）选择
- 订单状态机内置「meeting」环节，要求双方约定时间地点线下见面
- 学生认证徽章 + 信用分（基于评价自动加减分）让劣质卖家曝光
- 「举报」入口覆盖商品和用户，管理员可在后台一键下架/封禁

### 离线友好

小程序本地缓存 `cm_openid` 避免重复登录；聊天页用 5s 轮询拉新消息（演示版，生产可换 WebSocket）。订单、收藏等列表均支持下拉刷新与上拉加载更多。

### 扩展点

- 把 `chat` 的轮询换成 [云函数定时触发器](https://developers.weixin.qq.com/miniprogram/dev/wxcloud/guide/functions/triggers.html) 推送
- 商品搜索接 [微信云开发 AI 能力](https://developers.weixin.qq.com/miniprogram/dev/wxcloud/basis/ai.html) 做向量检索
- 收藏 / 想要的社交化筛选与同校推荐流（规划中）
- 信用分引入更多维度（发布数 / 履约率 / 申诉记录）

## 📄 License

MIT — 教学/毕设/校园运营均可自由使用。
