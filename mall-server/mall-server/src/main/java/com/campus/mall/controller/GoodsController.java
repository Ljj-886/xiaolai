package com.campus.mall.controller;

import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.campus.mall.common.PageResult;
import com.campus.mall.common.Param;
import com.campus.mall.common.R;
import com.campus.mall.common.TextUtil;
import com.campus.mall.entity.Goods;
import com.campus.mall.service.GoodsService;
import jakarta.annotation.Resource;
import org.springframework.web.bind.annotation.*;

import java.math.BigDecimal;
import java.util.Map;

@RestController
public class GoodsController {

    @Resource
    private GoodsService goodsService;

    @PostMapping("/api/goods")
    public R<?> dispatch(@RequestBody Map<String, Object> req) {
        Param p = new Param(req);
        String action = p.s("action");
        if (action == null) return R.fail("缺少 action");
        switch (action) {
            case "list": {
                long current = p.l("page") == null ? 1 : p.l("page");
                long size = p.l("pageSize") == null ? 10 : p.l("pageSize");
                Page<Goods> page = goodsService.listGoods(p.s("campus"), p.s("category"), p.s("keyword"), p.s("type"), current, size);
                return R.ok(PageResult.of(page));
            }
            case "search": {
                long current = p.l("page") == null ? 1 : p.l("page");
                long size = p.l("pageSize") == null ? 10 : p.l("pageSize");
                Page<Goods> page = goodsService.search(p.s("keyword"), p.s("campus"), current, size);
                return R.ok(PageResult.of(page));
            }
            case "detail": {
                Goods g = goodsService.getById(p.s("id"));
                if (g == null) return R.fail(404, "商品不存在");
                return R.ok(g);
            }
            case "publish": {
                Goods g = goodsService.publish(toGoods(req));
                return R.ok(g);
            }
            case "update": {
                boolean ok = goodsService.updateGoods(p.s("id"), toGoods(req));
                return R.ok(ok);
            }
            case "setStatus": {
                boolean ok = goodsService.updateStatus(p.s("id"), p.s("status"), p.s("offType"), p.s("offReason"));
                return R.ok(ok);
            }
            case "myGoods": {
                long current = p.l("page") == null ? 1 : p.l("page");
                long size = p.l("pageSize") == null ? 10 : p.l("pageSize");
                Page<Goods> page = goodsService.myGoods(p.s("openid"), p.s("status"), p.s("category"), p.s("type"), current, size);
                return R.ok(PageResult.of(page));
            }
            case "myFavs": {
                long current = p.l("page") == null ? 1 : p.l("page");
                long size = p.l("pageSize") == null ? 10 : p.l("pageSize");
                Page<Goods> page = goodsService.myFavs(p.s("openid"), current, size);
                return R.ok(PageResult.of(page));
            }
            case "toggleFav": {
                boolean faved = goodsService.toggleFav(p.s("openid"), p.s("goodsId"));
                return R.ok(faved);
            }
            case "remove": {
                boolean ok = goodsService.removeGoods(p.s("id"), p.s("openid"));
                return R.ok(ok);
            }
            default:
                return R.fail("未知 action: " + action);
        }
    }

    private static final com.fasterxml.jackson.databind.ObjectMapper MAPPER =
            new com.fasterxml.jackson.databind.ObjectMapper();

    private Goods toGoods(Map<String, Object> req) {
        Param p = new Param(req);
        Goods g = new Goods();
        g.setId(p.s("id"));
        g.setOpenid(p.s("openid"));
        // 教室 MySQL 5.0.45 存不了 emoji（4 字节标题会让发布接口 500），写入前清洗
        g.setTitle(TextUtil.stripNonBmp(p.s("title")));
        g.setDescription(TextUtil.stripNonBmp(p.s("description")));
        // images 在 MySQL 里是 JSON 文本列。小程序传来的是数组（新发布）或 JSON 字符串
        // （编辑时原样回传）。若是数组必须序列化成 JSON 文本再存，绝不能直接 List.toString()
        // —— 否则会写成 "[url1, url2]"（非 JSON），前端 images[0] 会取到字符 "["。
        Object imagesRaw = req.get("images");
        if (imagesRaw instanceof java.util.List) {
            try {
                g.setImages(MAPPER.writeValueAsString(imagesRaw));
            } catch (Exception e) {
                g.setImages(p.s("images"));
            }
        } else {
            g.setImages(p.s("images"));
        }
        // 封面：前端 publish.js 从来没传 cover（只传 images 数组），
        // 于是 g.cover 恒为 null → 首页卡片/订单卡/聊天商品引用全是灰色占位图。
        // 这里在 cover 为空时用 images[0] 兜底，让存量逻辑无需改动。
        String cover = p.s("cover");
        if ((cover == null || cover.isEmpty()) && g.getImages() != null && !g.getImages().isEmpty()) {
            try {
                java.util.List<?> imgs = MAPPER.readValue(g.getImages(), java.util.List.class);
                if (!imgs.isEmpty() && imgs.get(0) != null) cover = String.valueOf(imgs.get(0));
            } catch (Exception ignored) {}
        }
        g.setCover(cover);
        // ⚠️ 前端对「未填写的原价/价格」会传空串 ""，new BigDecimal("") 必抛异常 → 500。
        // 小程序发布/编辑时 originalPrice 默认就是空串，求购(want)的 price 也可能是空串，
        // 因此这里统一做「空/非数字 → null」的安全解析，避免整条发布 500。
        g.setPrice(toDecimal(p.o("price")));
        g.setOriginalPrice(toDecimal(p.o("originalPrice")));
        g.setCategory(p.s("category"));
        g.setCondition(p.s("condition"));
        g.setCampus(p.s("campus"));
        g.setPickupPoint(p.s("pickupPoint"));
        g.setType(p.s("type") == null ? "sell" : p.s("type"));
        g.setStatus(p.s("status"));
        return g;
    }

    /** 安全解析金额：null / 空串 / 非数字 → null（防止 new BigDecimal("") 抛异常导致整条请求 500） */
    private static BigDecimal toDecimal(Object v) {
        if (v == null) return null;
        String s = v.toString().trim();
        if (s.isEmpty()) return null;
        try {
            return new BigDecimal(s);
        } catch (NumberFormatException e) {
            return null;
        }
    }
}
