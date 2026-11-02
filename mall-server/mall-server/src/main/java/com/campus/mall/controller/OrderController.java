package com.campus.mall.controller;

import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.campus.mall.common.PageResult;
import com.campus.mall.common.Param;
import com.campus.mall.common.R;
import com.campus.mall.common.TextUtil;
import com.campus.mall.entity.Order;
import com.campus.mall.service.OrderService;
import com.campus.mall.service.UserService;
import jakarta.annotation.Resource;
import org.springframework.web.bind.annotation.*;

import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.Map;

@RestController
public class OrderController {

    /** 评价列是 JSON 文本，detail 里要解析成对象才能让模板读到 .score/.content */
    private static final com.fasterxml.jackson.databind.ObjectMapper MAPPER = new com.fasterxml.jackson.databind.ObjectMapper();

    @Resource
    private OrderService orderService;

    @Resource
    private UserService userService;

    @PostMapping("/api/order")
    public R<?> dispatch(@RequestBody Map<String, Object> req) {
        Param p = new Param(req);
        String action = p.s("action");
        if (action == null) return R.fail("缺少 action");
        switch (action) {
            case "create": {
                Order o = toOrder(req);
                return R.ok(orderService.create(o));
            }
            case "list": {
                long current = p.l("page") == null ? 1 : p.l("page");
                long size = p.l("pageSize") == null ? 10 : p.l("pageSize");
                Page<Order> page = orderService.list(p.s("openid"), p.s("role"), p.s("status"), current, size);
                return R.ok(PageResult.of(page));
            }
            case "detail": {
                Order o = orderService.detail(p.s("id") != null ? p.s("id") : p.s("orderId"));
                if (o == null) return R.fail(404, "订单不存在");
                // 前端 order-detail.wxml 读的是 order.buyerInfo / order.sellerInfo 来渲染
                // 「对方信息」区块（昵称、头像、学校、信用、校园认证标签），
                // 而 orders 表里只有 buyerId/sellerId，不补这两个字段该区块会显示成空白头像+空昵称。
                // 这里用 getPublic 做白名单投影，不会带出手机号等隐私字段。
                if (o.getBuyerId() != null && !o.getBuyerId().isEmpty()) {
                    o.setBuyerInfo(userService.getPublic(o.getBuyerId()));
                }
                if (o.getSellerId() != null && !o.getSellerId().isEmpty()) {
                    o.setSellerInfo(userService.getPublic(o.getSellerId()));
                }
                // 评价在库里是 JSON 文本（longtext），前端模板读的是 order.buyerReview.score/.content。
                // 原样返回字符串会让「评价信息」区块显示成「（仅打分）★ 」——取不到字段。
                // 转成 Map 只影响响应体，实体字段类型不变（list 接口仍按字符串走）。
                Map<String, Object> data = new LinkedHashMap<>();
                data.putAll(MAPPER.convertValue(o, Map.class));
                data.put("buyerReview", parseReview(o.getBuyerReview()));
                data.put("sellerReview", parseReview(o.getSellerReview()));
                return R.ok(data);
            }
            case "sellerConfirm": {
                boolean ok = orderService.sellerConfirm(p.s("id") != null ? p.s("id") : p.s("orderId"), p.b("accept") == Boolean.TRUE);
                return R.ok(ok);
            }
            case "complete": {
                boolean ok = orderService.complete(p.s("id") != null ? p.s("id") : p.s("orderId"));
                return R.ok(ok);
            }
            case "buyerCancel":
            case "cancel": {
                boolean ok = orderService.buyerCancel(p.s("id") != null ? p.s("id") : p.s("orderId"));
                return R.ok(ok);
            }
            case "sellerCancel": {
                boolean ok = orderService.sellerCancel(p.s("id") != null ? p.s("id") : p.s("orderId"));
                return R.ok(ok);
            }
            case "checkTimeout": {
                int n = orderService.checkTimeout(30L * 60 * 1000);
                Map<String, Object> data = new HashMap<>();
                data.put("processed", n);
                return R.ok(data);
            }
            default:
                return R.fail("未知 action: " + action);
        }
    }

    /** 评价 JSON 文本 → 对象；空值/脏数据返回 null（前端 wxml 用 wx:if 判空） */
    private static Object parseReview(String raw) {
        if (raw == null || raw.trim().isEmpty()) return null;
        try {
            return MAPPER.readValue(raw, Map.class);
        } catch (Exception e) {
            return null;
        }
    }

    private Order toOrder(Map<String, Object> req) {        Param p = new Param(req);
        Order o = new Order();
        o.setId(p.s("id"));
        o.setGoodsId(p.s("goodsId"));
        o.setBuyerId(p.s("openid"));
        // 下单留言 / 自提点 / 取消原因都是自由文本，可能带 emoji -> 教室 5.0.45 会 1366
        o.setMessage(TextUtil.stripNonBmp(p.s("message")));
        o.setMeetingTime(p.s("meetingTime"));
        o.setMeetingPlace(TextUtil.stripNonBmp(p.s("meetingPlace")));
        o.setCancelReason(TextUtil.stripNonBmp(p.s("reason")));
        o.setCampus(TextUtil.stripNonBmp(p.s("campus")));
        return o;
    }
}
