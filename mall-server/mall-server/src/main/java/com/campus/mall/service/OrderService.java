package com.campus.mall.service;

import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.campus.mall.entity.Order;

public interface OrderService {

    /** 下单：生成 pending 订单，占用商品为 reserved */
    Order create(Order order);

    /** 订单列表：按 openid 作为买家或卖家查询 */
    Page<Order> list(String openid, String role, String status, long current, long size);

    Order detail(String id);

    /** 卖家确认面交：accept=true→meeting；false→取消并释放商品 */
    boolean sellerConfirm(String id, boolean accept);

    /** 买家完成交易：仅 meeting 可完成，商品置 sold */
    boolean complete(String id);

    /** 买家取消：订单取消，商品回 onSale */
    boolean buyerCancel(String id);

    /** 卖家取消：订单取消，商品回 onSale */
    boolean sellerCancel(String id);

    /** 超时巡检：pending 超过阈值置为取消并释放商品，返回处理数量 */
    int checkTimeout(long timeoutMs);
}
