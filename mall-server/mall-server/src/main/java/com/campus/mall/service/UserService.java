package com.campus.mall.service;

import com.campus.mall.entity.User;

import java.util.List;
import java.util.Map;

public interface UserService {

    User getByOpenid(String openid);

    /** 登录或首次资料写入（小程序 login 的等价物） */
    User upsert(User user);

    /** 更新个人资料 */
    User updateProfile(String openid, Map<String, Object> profile);

    /** 切换商品收藏，返回当前是否已收藏 */
    boolean toggleFav(String openid, String goodsId);

    /** 切换求购关注，返回当前是否已关注 */
    boolean toggleWant(String openid, String goodsId);

    /** 公开信息（给聊天对方/卖家看，剥离敏感字段） */
    Map<String, Object> getPublic(String openid);

    /**
     * 我的信用分页数据。
     * ⚠️ 必须返回 Map 而不是单个 int：前端 `pages/credit/credit.js` 读的是
     * `r.credit / r.soldCount / r.boughtCount / r.reviewCount / r.avgScore / r.reviews`，
     * 只返回数字会让整页退化成「信用分 100 + 评价数 0 + 永远没有评价」。
     */
    Map<String, Object> myCredit(String openid);

    /**
     * 评价订单（买家评卖家 / 卖家评买家）。
     * 评价正文写进 `orders.buyer_review` / `orders.seller_review`（JSON 文本，列注释约定
     * `{score,tags[],content,createdAt}`），并按星级调整**被评价人**的信用分。
     *
     * @return 是否本次写入成功；false 表示已评价过（一单一评，不覆盖）
     */
    boolean review(String orderId, String openid, Integer score, List<String> tags, String content);

    /** 待认证列表 */
    List<User> listPendingVerify();

    /** 审核认证 */
    boolean reviewVerify(String openid, boolean pass);

    /** 学生提交认证申请（java 演示版：自动通过） */
    User applyVerify(String openid, Map<String, Object> req);
}
