package com.campus.mall.service;

import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.campus.mall.entity.Goods;

public interface GoodsService {

    /** 商品列表（首页/分类/搜索）：仅 onSale、campus 多校隔离、category 筛选、keyword 模糊 */
    Page<Goods> listGoods(String campus, String category, String keyword, long current, long size);

    /** 同上，额外支持 type 分流（sell / want），null 表示不限 */
    Page<Goods> listGoods(String campus, String category, String keyword, String type, long current, long size);

    /** 搜索（同列表，但不过滤 onSale，便于后台/我的里用） */
    Page<Goods> search(String keyword, String campus, long current, long size);

    Goods getById(String id);

    /** 发布商品（插入，演示直接 onSale 便于立即看到） */
    Goods publish(Goods goods);

    /** 编辑商品（仅本人，按 id 条件更新） */
    boolean updateGoods(String id, Goods goods);

    /** 状态流转（上架/下架/售出/封禁），带条件更新，防并发双写 */
    boolean updateStatus(String id, String status, String offType, String offReason);

    /** 我的商品（按 openid，可选 status） */
    Page<Goods> myGoods(String openid, String status, String category, String type, long current, long size);

    /** 我的收藏（连 favorites 表取商品） */
    Page<Goods> myFavs(String openid, long current, long size);

    /** 切换收藏：已收藏则取消并 favCount-1，否则添加并 favCount+1。返回当前是否已收藏 */
    boolean toggleFav(String openid, String goodsId);

    /** 删除商品（仅本人） */
    boolean removeGoods(String id, String openid);
}
