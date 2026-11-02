package com.campus.mall.service.impl;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.core.conditions.update.UpdateWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.campus.mall.entity.Goods;
import com.campus.mall.entity.Order;
import com.campus.mall.mapper.GoodsMapper;
import com.campus.mall.mapper.OrderMapper;
import com.campus.mall.service.OrderService;
import org.springframework.stereotype.Service;

import jakarta.annotation.Resource;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@Service
public class OrderServiceImpl implements OrderService {

    private static final com.fasterxml.jackson.databind.ObjectMapper MAPPER = new com.fasterxml.jackson.databind.ObjectMapper();

    @Resource
    private OrderMapper orderMapper;

    @Resource
    private GoodsMapper goodsMapper;

    @Override
    public Order create(Order order) {
        long now = System.currentTimeMillis();
        // 用商品真实数据填充订单，防止前端传参篡改价格/卖家
        Goods g = goodsMapper.selectById(order.getGoodsId());
        if (g == null) throw new RuntimeException("商品不存在");
        if (!"onSale".equals(g.getStatus())) throw new RuntimeException("商品当前不可购买");

        if (order.getId() == null || order.getId().isEmpty()) {
            order.setId(UUID.randomUUID().toString().replace("-", ""));
        }
        order.setOrderNo("CM" + now + (int) (Math.random() * 1000));
        order.setSellerId(g.getOpenid());
        order.setPrice(g.getPrice());
        order.setCampus(g.getCampus());
        order.setGoodsSnapshot(buildSnapshot(g)); // 之前从不写 → 订单卡没有标题/封面
        order.setStatus("pending");
        order.setCreatedAt(now);
        order.setUpdatedAt(now);
        orderMapper.insert(order);

        // 占用商品
        UpdateWrapper<Goods> uw = new UpdateWrapper<>();
        uw.eq("id", g.getId()).eq("status", "onSale").set("status", "reserved").set("updated_at", now);
        goodsMapper.update(null, uw);
        return order;
    }

    /**
     * 下单时冻结商品关键信息。商品之后被删/改价/下架，订单里仍能看到当时的标题与图。
     * 字段名必须与 `pages/order/order.wxml` 读取的一致（title / cover / price …）。
     */
    private Map<String, Object> buildSnapshot(Goods g) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", g.getId());
        m.put("title", g.getTitle());
        // 存量商品的 cover 可能为空（老版本 publish 没传 cover），用 images[0] 兜底，
        // 否则订单卡永远是一块灰色占位图
        String cover = g.getCover();
        if ((cover == null || cover.isEmpty()) && g.getImages() != null) {
            try {
                List<?> imgs = MAPPER.readValue(g.getImages(), List.class);
                if (!imgs.isEmpty() && imgs.get(0) != null) cover = String.valueOf(imgs.get(0));
            } catch (Exception ignored) {}
        }
        m.put("cover", cover);
        m.put("price", g.getPrice());
        m.put("originalPrice", g.getOriginalPrice());
        m.put("category", g.getCategory());
        m.put("condition", g.getCondition());
        m.put("campus", g.getCampus());
        m.put("pickupPoint", g.getPickupPoint());
        m.put("sellerOpenid", g.getOpenid());
        m.put("type", g.getType());
        return m;
    }

    @Override
    public Page<Order> list(String openid, String role, String status, long current, long size) {
        QueryWrapper<Order> qw = new QueryWrapper<>();
        if ("seller".equals(role)) qw.eq("seller_id", openid);
        else qw.eq("buyer_id", openid);
        if (status != null && !status.isEmpty()) qw.eq("status", status);
        qw.orderByDesc("created_at");
        return orderMapper.selectPage(new Page<>(current, size), qw);
    }

    @Override
    public Order detail(String id) {
        return orderMapper.selectById(id);
    }

    @Override
    public boolean sellerConfirm(String id, boolean accept) {
        Order o = orderMapper.selectById(id);
        if (o == null) return false;
        if (accept) {
            UpdateWrapper<Order> uw = new UpdateWrapper<>();
            uw.eq("id", id).eq("status", "pending")
              .set("status", "meeting").set("seller_confirm_at", System.currentTimeMillis())
              .set("updated_at", System.currentTimeMillis());
            return orderMapper.update(null, uw) == 1;
        } else {
            cancelOrder(id, o.getGoodsId());
            return true;
        }
    }

    @Override
    public boolean complete(String id) {
        Order o = orderMapper.selectById(id);
        if (o == null) return false;
        UpdateWrapper<Order> uw = new UpdateWrapper<>();
        uw.eq("id", id).eq("status", "meeting")
          .set("status", "completed").set("completed_at", System.currentTimeMillis())
          .set("completed_by", o.getBuyerId()).set("updated_at", System.currentTimeMillis());
        boolean ok = orderMapper.update(null, uw) == 1;
        if (ok && o.getGoodsId() != null) {
            UpdateWrapper<Goods> guw = new UpdateWrapper<>();
            guw.eq("id", o.getGoodsId()).set("status", "sold").set("updated_at", System.currentTimeMillis());
            goodsMapper.update(null, guw);
        }
        return ok;
    }

    @Override
    public boolean buyerCancel(String id) {
        Order o = orderMapper.selectById(id);
        if (o == null) return false;
        cancelOrder(id, o.getGoodsId());
        return true;
    }

    @Override
    public boolean sellerCancel(String id) {
        Order o = orderMapper.selectById(id);
        if (o == null) return false;
        cancelOrder(id, o.getGoodsId());
        return true;
    }

    private void cancelOrder(String orderId, String goodsId) {
        long now = System.currentTimeMillis();
        UpdateWrapper<Order> uw = new UpdateWrapper<>();
        uw.eq("id", orderId).set("status", "cancelled")
          .set("cancelled_by", "system").set("updated_at", now);
        orderMapper.update(null, uw);
        if (goodsId != null) {
            UpdateWrapper<Goods> guw = new UpdateWrapper<>();
            guw.eq("id", goodsId).eq("status", "reserved")
              .set("status", "onSale").set("updated_at", now);
            goodsMapper.update(null, guw);
        }
    }

    @Override
    public int checkTimeout(long timeoutMs) {
        long threshold = System.currentTimeMillis() - timeoutMs;
        QueryWrapper<Order> qw = new QueryWrapper<>();
        qw.eq("status", "pending").lt("created_at", threshold);
        var list = orderMapper.selectList(qw);
        int n = 0;
        for (Order o : list) {
            cancelOrder(o.getId(), o.getGoodsId());
            n++;
        }
        return n;
    }
}
