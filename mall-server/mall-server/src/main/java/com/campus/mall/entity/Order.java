package com.campus.mall.entity;

import com.baomidou.mybatisplus.annotation.TableName;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.extension.handlers.JacksonTypeHandler;
import lombok.Data;

import java.io.Serializable;
import java.math.BigDecimal;
import java.util.Map;

@Data
@TableName(value = "orders", autoResultMap = true) // autoResultMap 必须开：否则 typeHandler 只作用于写、查询不生效
public class Order implements Serializable {
    @TableId
    private String id;
    private String orderNo;
    private String goodsId;
    /**
     * 商品快照（下单那一刻的标题/封面/价格，商品被删改后订单仍能正常显示）。
     * ⚠️ 前端 order.wxml 读的是 `item.goodsSnapshot.title` / `.cover`，即**对象**。
     * 库里存的是 JSON 文本（longtext），所以这里用 JacksonTypeHandler 双向转换；
     * 若保持 String 类型，前端拿到字符串后 `.title` 恒 undefined → 订单卡只剩占位图（2026-10-25 踩过）。
     */
    @TableField(typeHandler = JacksonTypeHandler.class)
    private Map<String, Object> goodsSnapshot;
    private String buyerId;
    private String sellerId;
    private BigDecimal price;
    private String status;        // pending/meeting/completed/cancelled
    private String meetingTime;
    private String meetingPlace;
    private String message;
    private String campus;
    private String cancelReason;
    private String cancelledBy;
    private Integer autoCancelled;
    private Long sellerConfirmAt;
    private Long completedAt;
    private String completedBy;
    private String buyerReview;   // 评价（JSON 文本）
    private String sellerReview;  // 评价（JSON 文本）
    private Long createdAt;
    private Long updatedAt;

    // 订单详情页要展示「对方信息」（昵称/头像/学校/信用），
    // 但 orders 表里只有 buyerId/sellerId，没有这些展示字段。
    // 这两个不是数据库列，由 OrderController 的 detail 现场 join 填充。
    @TableField(exist = false)
    private Map<String, Object> buyerInfo;
    @TableField(exist = false)
    private Map<String, Object> sellerInfo;
}
