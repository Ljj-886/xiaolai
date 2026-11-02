# 数据库设计

> 微信云开发（CloudBase）NoSQL 数据库。集合（Collection）等同于关系型数据库的「表」，文档（Document）等同于「行」。

## 集合一览

| 集合 | 用途 | 主要字段 |
| --- | --- | --- |
| users | 用户档案 | _openid, nickName, avatarUrl, school, studentId, verified, credit, isAdmin, status |
| goods | 商品 | _openid, title, images, price, category, condition, status, viewCount, favCount |
| orders | 订单 | orderNo, goodsSnapshot, buyerId, sellerId, price, status, meetingTime, meetingPlace |
| conversations | 会话 | participants, goodsId, lastMessage, unread, goodsSnapshot |
| messages | 消息 | convId, _openid, type, content, createdAt, read |
| favorites | 收藏 | _openid, goodsId, createdAt |
| reports | 举报 | reporterOpenid, targetType, targetId, reason, desc, status, handleResult |
| reviews | 评价 | orderId, fromOpenid, toOpenid, score, tags, content |
| categories | 分类字典 | key, name, icon, sort |
| pickup_points | 自提点 | name, desc, campus |

> 提示：集合会在首次写入时自动创建，但建议预先在云开发控制台创建并设置权限。

## 权限建议

| 集合 | 读 | 写 |
| --- | --- | --- |
| users | 仅本人 / 公开字段（nickName, avatarUrl, verified, credit）所有人可读 | 仅本人 |
| goods | 所有人 | 仅创建者（管理员可下架） |
| orders | 仅买家与卖家 | 仅买家与卖家 |
| conversations | 仅参与方 | 仅参与方 |
| messages | 仅参与方 | 仅自己（create）；admin 可读 |
| favorites | 仅本人 | 仅本人 |
| reports | 仅管理员 | 任意 |
| categories / pickup_points | 所有人 | 仅管理员 |

> 云开发默认权限较粗，演示版简化处理。生产环境请用「自定义安全规则」按 `_openid` 字段精细控制。

## 索引建议

```js
// goods
db.collection('goods').createIndex({ status: 1, createdAt: -1 })  // 首页/分类
db.collection('goods').createIndex({ _openid: 1, status: 1, createdAt: -1 }) // 我的商品

// orders
db.collection('orders').createIndex({ buyerId: 1, createdAt: -1 })
db.collection('orders').createIndex({ sellerId: 1, createdAt: -1 })
db.collection('orders').createIndex({ orderNo: 1 }, { unique: true })

// messages / conversations
db.collection('conversations').createIndex({ participants: 1, lastMessageAt: -1 })
db.collection('messages').createIndex({ convId: 1, createdAt: -1 })

// favorites
db.collection('favorites').createIndex({ _openid: 1, goodsId: 1 }, { unique: true })
```

## 关键设计

### 1. 商品状态机
```
onSale --(被下单)--> reserved --(完成/取消)--> sold / onSale
任何状态 --(卖家下架)--> off
```

### 2. 订单状态机
```
pending --(卖家同意)--> meeting --(任一方点完成)--> completed
pending --(卖家拒绝/买家取消)--> cancelled
completed --(双方互评)--> completed
```

### 3. 会话 ID
`conversations._id = sort([a, b]).join('_') + '_' + goodsId`
按商品粒度，同一对买卖双方聊不同商品是不同的会话。

### 4. 信用分
- 初始 100
- 评价 4-5 星：+2；3 星：+0；1-2 星：-3
- 可被管理员直接调整

### 5. 评价
- 存放在 `orders.buyerReview` / `orders.sellerReview`，避免再建独立集合
- 双向评价，互相不可见（直到双方都评完可选显示）

### 6. 软删除
所有删除均为 `status = 'off'`，便于申诉与恢复。
