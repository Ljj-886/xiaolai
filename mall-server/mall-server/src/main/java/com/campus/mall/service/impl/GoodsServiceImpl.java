package com.campus.mall.service.impl;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.core.conditions.update.UpdateWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.campus.mall.entity.Favorite;
import com.campus.mall.entity.Goods;
import com.campus.mall.mapper.FavoriteMapper;
import com.campus.mall.mapper.GoodsMapper;
import com.campus.mall.service.GoodsService;
import org.springframework.stereotype.Service;

import jakarta.annotation.Resource;
import java.math.BigDecimal;
import java.util.Collections;
import java.util.List;
import java.util.UUID;
import java.util.stream.Collectors;

@Service
public class GoodsServiceImpl implements GoodsService {

    @Resource
    private GoodsMapper goodsMapper;

    @Resource
    private FavoriteMapper favoriteMapper;

    @Override
    public Page<Goods> listGoods(String campus, String category, String keyword, long current, long size) {
        return listGoods(campus, category, keyword, null, current, size);
    }

    @Override
    public Page<Goods> listGoods(String campus, String category, String keyword, String type, long current, long size) {
        QueryWrapper<Goods> qw = new QueryWrapper<>();
        qw.eq("status", "onSale");
        if (campus != null && !campus.isEmpty()) qw.eq("campus", campus);
        if (category != null && !category.isEmpty()) qw.eq("category", category);
        if (keyword != null && !keyword.isEmpty()) qw.like("title", keyword);
        // 出售/求购分流：前端首页虽会按 item.type 再兜底过滤一次，但那是「取一页再筛」，
        // 商品多于一页时求购页可能整页都是出售而显示空白。这里在 DB 层过滤才稳。
        // type 为空/null 的老数据一律视作出售（与前端 index.js 的兜底规则保持一致）。
        if ("want".equals(type)) qw.eq("type", "want");
        else if ("sell".equals(type)) qw.and(w -> w.ne("type", "want").or().isNull("type"));
        qw.orderByDesc("created_at");
        return goodsMapper.selectPage(new Page<>(current, size), qw);
    }

    @Override
    public Page<Goods> search(String keyword, String campus, long current, long size) {
        QueryWrapper<Goods> qw = new QueryWrapper<>();
        if (keyword != null && !keyword.isEmpty()) qw.like("title", keyword);
        if (campus != null && !campus.isEmpty()) qw.eq("campus", campus);
        qw.ne("status", "banned").orderByDesc("created_at");
        return goodsMapper.selectPage(new Page<>(current, size), qw);
    }

    @Override
    public Goods getById(String id) {
        return goodsMapper.selectById(id);
    }

    @Override
    public Goods publish(Goods goods) {
        long now = System.currentTimeMillis();
        if (goods.getId() == null || goods.getId().isEmpty()) {
            goods.setId(UUID.randomUUID().toString().replace("-", ""));
        }
        goods.setCreatedAt(now);
        goods.setUpdatedAt(now);
        // 演示版开启「管理员审核」流程：新发布商品先进入 pending（待审核），
        // 不会出现在首页（listGoods 只查 onSale），需管理员在后台审核通过后才上架。
        if (goods.getStatus() == null || goods.getStatus().isEmpty()) goods.setStatus("pending");
        if (goods.getType() == null || goods.getType().isEmpty()) goods.setType("sell");
        if (goods.getViewCount() == null) goods.setViewCount(0);
        if (goods.getFavCount() == null) goods.setFavCount(0);
        if (goods.getWantCount() == null) goods.setWantCount(0);
        goodsMapper.insert(goods);
        return goods;
    }

    @Override
    public boolean updateGoods(String id, Goods goods) {
        Goods exist = goodsMapper.selectById(id);
        if (exist == null) return false;
        UpdateWrapper<Goods> uw = new UpdateWrapper<>();
        uw.eq("id", id);
        if (goods.getTitle() != null) uw.set("title", goods.getTitle());
        if (goods.getDescription() != null) uw.set("description", goods.getDescription());
        if (goods.getImages() != null) uw.set("images", goods.getImages());
        if (goods.getCover() != null) uw.set("cover", goods.getCover());
        if (goods.getPrice() != null) uw.set("price", goods.getPrice());
        if (goods.getOriginalPrice() != null) uw.set("original_price", goods.getOriginalPrice());
        if (goods.getCategory() != null) uw.set("category", goods.getCategory());
        if (goods.getCondition() != null) uw.set("condition", goods.getCondition());
        if (goods.getCampus() != null) uw.set("campus", goods.getCampus());
        if (goods.getPickupPoint() != null) uw.set("pickup_point", goods.getPickupPoint());
        if (goods.getType() != null) uw.set("type", goods.getType());
        if (goods.getStatus() != null) uw.set("status", goods.getStatus());
        uw.set("updated_at", System.currentTimeMillis());
        return goodsMapper.update(null, uw) == 1;
    }

    @Override
    public boolean updateStatus(String id, String status, String offType, String offReason) {
        UpdateWrapper<Goods> uw = new UpdateWrapper<>();
        uw.eq("id", id).set("status", status).set("updated_at", System.currentTimeMillis());
        if (offType != null) uw.set("off_type", offType);
        if (offReason != null) uw.set("off_reason", offReason);
        if ("off".equals(status) || "banned".equals(status)) uw.set("off_at", System.currentTimeMillis());
        return goodsMapper.update(null, uw) == 1;
    }

    @Override
    public Page<Goods> myGoods(String openid, String status, String category, String type, long current, long size) {
        QueryWrapper<Goods> qw = new QueryWrapper<>();
        qw.eq("openid", openid);
        if (status != null && !status.isEmpty()) qw.eq("status", status);
        else qw.ne("status", "banned");
        if (category != null && !category.isEmpty()) qw.eq("category", category);
        if (type != null && !type.isEmpty()) qw.eq("type", type);
        qw.orderByDesc("created_at");
        return goodsMapper.selectPage(new Page<>(current, size), qw);
    }

    @Override
    public Page<Goods> myFavs(String openid, long current, long size) {
        QueryWrapper<Favorite> qw = new QueryWrapper<>();
        qw.eq("openid", openid).orderByDesc("created_at");
        Page<Favorite> fpage = favoriteMapper.selectPage(new Page<>(current, size), qw);
        List<String> ids = fpage.getRecords().stream().map(Favorite::getGoodsId).collect(Collectors.toList());
        List<Goods> goodsList = ids.isEmpty() ? Collections.emptyList() : goodsMapper.selectBatchIds(ids);
        Page<Goods> result = new Page<>(current, size, fpage.getTotal());
        result.setRecords(goodsList);
        return result;
    }

    @Override
    public boolean toggleFav(String openid, String goodsId) {
        QueryWrapper<Favorite> qw = new QueryWrapper<>();
        qw.eq("openid", openid).eq("goods_id", goodsId);
        Favorite exist = favoriteMapper.selectOne(qw);
        if (exist != null) {
            favoriteMapper.deleteById(exist.getId());
            favCount(goodsId, -1);
            return false;
        } else {
            Favorite f = new Favorite();
            f.setId(UUID.randomUUID().toString().replace("-", ""));
            f.setOpenid(openid);
            f.setGoodsId(goodsId);
            f.setCreatedAt(System.currentTimeMillis());
            favoriteMapper.insert(f);
            favCount(goodsId, 1);
            return true;
        }
    }

    private void favCount(String goodsId, int delta) {
        Goods g = goodsMapper.selectById(goodsId);
        if (g == null) return;
        int cur = g.getFavCount() == null ? 0 : g.getFavCount();
        int next = Math.max(0, cur + delta);
        UpdateWrapper<Goods> uw = new UpdateWrapper<>();
        uw.eq("id", goodsId).set("fav_count", next);
        goodsMapper.update(null, uw);
    }

    @Override
    public boolean removeGoods(String id, String openid) {
        QueryWrapper<Goods> qw = new QueryWrapper<>();
        qw.eq("id", id);
        if (openid != null && !openid.isEmpty()) qw.eq("openid", openid);
        return goodsMapper.delete(qw) > 0;
    }
}
