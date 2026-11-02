package com.campus.mall.service.impl;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.core.conditions.update.UpdateWrapper;
import com.campus.mall.common.Constants;
import com.campus.mall.entity.Favorite;
import com.campus.mall.entity.Order;
import com.campus.mall.entity.User;
import com.campus.mall.entity.Want;
import com.campus.mall.mapper.FavoriteMapper;
import com.campus.mall.mapper.OrderMapper;
import com.campus.mall.mapper.UserMapper;
import com.campus.mall.mapper.WantMapper;
import com.campus.mall.service.UserService;
import org.springframework.stereotype.Service;

import jakarta.annotation.Resource;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@Service
public class UserServiceImpl implements UserService {

    @Resource
    private UserMapper userMapper;

    @Resource
    private FavoriteMapper favoriteMapper;

    @Resource
    private WantMapper wantMapper;

    @Resource
    private OrderMapper orderMapper;

    private static final com.fasterxml.jackson.databind.ObjectMapper MAPPER = new com.fasterxml.jackson.databind.ObjectMapper();

    /** 评价标签上限：前端 6 个标签全选也就 6 个，超过的当脏数据丢掉 */
    private static final int MAX_TAGS = 8;
    /** 评价正文字数上限，与小程序 textarea maxlength=200 一致 */
    private static final int MAX_CONTENT = 200;

    @Override
    public User getByOpenid(String openid) {
        return userMapper.selectOne(new QueryWrapper<User>().eq("openid", openid));
    }

    @Override
    public User upsert(User user) {
        long now = System.currentTimeMillis();
        User exist = getByOpenid(user.getOpenid());
        if (exist != null) {
            // 演示管理员身份兜底：若库里 is_admin 为空，按 openid 是否管理员补标，避免登录后拿不到 isAdmin
            if (exist.getIsAdmin() == null) {
                exist.setIsAdmin(Constants.ADMIN_OPENID.equals(user.getOpenid()) ? 1 : 0);
                userMapper.updateById(exist);
            }
            if (user.getNickName() != null) exist.setNickName(user.getNickName());
            if (user.getAvatarUrl() != null) exist.setAvatarUrl(user.getAvatarUrl());
            if (user.getSchool() != null) exist.setSchool(user.getSchool());
            // 显式传入的管理员标记要回写：否则老行 is_admin 恒为 0，
            // 「我的」页入口靠 me 临时补值能显示，但后台用户列表永远显示非管理员。
            if (user.getIsAdmin() != null) exist.setIsAdmin(user.getIsAdmin());
            exist.setUpdatedAt(now);
            userMapper.updateById(exist);
            return exist;
        }
        if (user.getId() == null || user.getId().isEmpty()) {
            user.setId(UUID.randomUUID().toString().replace("-", ""));
        }
        user.setCreatedAt(now);
        user.setUpdatedAt(now);
        if (user.getStatus() == null) user.setStatus("active");
        if (user.getCredit() == null) user.setCredit(100);
        // 演示版：固定 openid 即管理员（满足「只有我一个人能审核」）
        user.setIsAdmin(Constants.ADMIN_OPENID.equals(user.getOpenid()) ? 1 : 0);
        userMapper.insert(user);
        return user;
    }

    @Override
    public User updateProfile(String openid, Map<String, Object> profile) {
        User exist = getByOpenid(openid);
        if (exist == null) return null;
        if (profile.get("nickName") != null) exist.setNickName(String.valueOf(profile.get("nickName")));
        if (profile.get("avatarUrl") != null) exist.setAvatarUrl(String.valueOf(profile.get("avatarUrl")));
        if (profile.get("school") != null) exist.setSchool(String.valueOf(profile.get("school")));
        if (profile.get("gender") != null) exist.setGender(String.valueOf(profile.get("gender")));
        if (profile.get("education") != null) exist.setEducation(String.valueOf(profile.get("education")));
        if (profile.get("realName") != null) exist.setRealName(String.valueOf(profile.get("realName")));
        if (profile.get("studentId") != null) exist.setStudentId(String.valueOf(profile.get("studentId")));
        exist.setUpdatedAt(System.currentTimeMillis());
        userMapper.updateById(exist);
        return exist;
    }

    @Override
    public boolean toggleFav(String openid, String goodsId) {
        QueryWrapper<Favorite> qw = new QueryWrapper<>();
        qw.eq("openid", openid).eq("goods_id", goodsId);
        Favorite exist = favoriteMapper.selectOne(qw);
        if (exist != null) {
            favoriteMapper.deleteById(exist.getId());
            return false;
        }
        Favorite f = new Favorite();
        f.setId(UUID.randomUUID().toString().replace("-", ""));
        f.setOpenid(openid);
        f.setGoodsId(goodsId);
        f.setCreatedAt(System.currentTimeMillis());
        favoriteMapper.insert(f);
        return true;
    }

    @Override
    public boolean toggleWant(String openid, String goodsId) {
        QueryWrapper<Want> qw = new QueryWrapper<>();
        qw.eq("openid", openid).eq("goods_id", goodsId);
        Want exist = wantMapper.selectOne(qw);
        if (exist != null) {
            wantMapper.deleteById(exist.getId());
            return false;
        }
        Want w = new Want();
        w.setId(UUID.randomUUID().toString().replace("-", ""));
        w.setOpenid(openid);
        w.setGoodsId(goodsId);
        w.setCreatedAt(System.currentTimeMillis());
        wantMapper.insert(w);
        return true;
    }

    @Override
    public Map<String, Object> getPublic(String openid) {
        User u = getByOpenid(openid);
        Map<String, Object> m = new HashMap<>();
        if (u == null) {
            m.put("nickName", "已注销用户");
            return m;
        }
        m.put("openid", u.getOpenid());
        m.put("nickName", u.getNickName());
        m.put("avatarUrl", u.getAvatarUrl());
        m.put("school", u.getSchool());
        m.put("credit", u.getCredit() == null ? 100 : u.getCredit());
        m.put("soldCount", u.getSoldCount() == null ? 0 : u.getSoldCount());
        m.put("boughtCount", u.getBoughtCount() == null ? 0 : u.getBoughtCount());
        // 订单详情/聊天室要显示「校园认证」标签，缺了这个字段标签永远不渲染
        m.put("verified", u.getVerified() == null ? 0 : u.getVerified());
        return m;
    }

    @Override
    public Map<String, Object> myCredit(String openid) {
        User u = (openid == null) ? null : getByOpenid(openid);
        int credit = (u == null || u.getCredit() == null) ? 100 : u.getCredit();

        Map<String, Object> out = new HashMap<>();
        out.put("credit", credit);

        // 成交数：只有 completed 才算数（pending/meeting 还没交付，cancelled 更不算）
        long soldCount = 0, boughtCount = 0;
        List<Map<String, Object>> received = new ArrayList<>();
        if (openid != null && !openid.isEmpty()) {
            soldCount = orderMapper.selectCount(new QueryWrapper<Order>()
                    .eq("seller_id", openid).eq("status", "completed"));
            boughtCount = orderMapper.selectCount(new QueryWrapper<Order>()
                    .eq("buyer_id", openid).eq("status", "completed"));

            // 「收到的评价」分布在订单的两列上，取决于我当时是买家还是卖家：
            //   我是买家 → 卖家给我的评价在 seller_review
            //   我是卖家 → 买家给我的评价在 buyer_review
            // 不能只查一列，否则总有一方的「收到的评价」永远为空。
            List<Order> asBuyer = orderMapper.selectList(new QueryWrapper<Order>()
                    .eq("buyer_id", openid).isNotNull("seller_review").ne("seller_review", ""));
            for (Order o : asBuyer) {
                Map<String, Object> item = toReviewItem(o, o.getSellerReview(), "卖家", o.getSellerId());
                if (item != null) received.add(item);
            }
            List<Order> asSeller = orderMapper.selectList(new QueryWrapper<Order>()
                    .eq("seller_id", openid).isNotNull("buyer_review").ne("buyer_review", ""));
            for (Order o : asSeller) {
                Map<String, Object> item = toReviewItem(o, o.getBuyerReview(), "买家", o.getBuyerId());
                if (item != null) received.add(item);
            }
        }

        // 按评价时间倒序（comparingLong 在这里会因为 getOrDefault 的 Object 返回类型推断失败，用显式比较器）
        received.sort((a, b) -> Long.compare(
                ((Number) b.getOrDefault("createdAt", 0L)).longValue(),
                ((Number) a.getOrDefault("createdAt", 0L)).longValue()));

        double sum = 0;
        int n = 0;
        for (Map<String, Object> m : received) {
            Object s = m.get("score");
            if (s instanceof Number) { sum += ((Number) s).doubleValue(); n++; }
        }
        out.put("soldCount", soldCount);
        out.put("boughtCount", boughtCount);
        out.put("reviewCount", received.size());
        // 没有评价时给 null 而不是 0：前端据此显示「-」，显示 0 分会像差评
        out.put("avgScore", n == 0 ? null : Math.round(sum / n * 10) / 10.0);
        out.put("reviews", received);
        return out;
    }

    /** 把订单里存的一列评价 JSON 解析成信用页要渲染的结构（解析失败跳过，不让脏数据炸整页） */
    private Map<String, Object> toReviewItem(Order o, String raw, String role, String fromOpenid) {
        if (raw == null || raw.trim().isEmpty()) return null;
        Map<String, Object> parsed;
        try {
            parsed = MAPPER.readValue(raw, Map.class);
        } catch (Exception e) {
            return null;
        }
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", o.getId());
        m.put("role", role);
        m.put("score", parsed.get("score"));
        Object tags = parsed.get("tags");
        m.put("tags", tags instanceof List ? tags : new ArrayList<>());
        m.put("content", parsed.get("content") == null ? "" : parsed.get("content"));
        Object at = parsed.get("createdAt");
        m.put("createdAt", at instanceof Number ? at : 0L);
        m.put("goodsTitle", goodsTitleOf(o));
        m.put("fromOpenid", fromOpenid);
        return m;
    }

    /** 商品标题优先取订单快照（商品改了名/下架也不影响历史评价可读性） */
    private String goodsTitleOf(Order o) {
        Object snap = o.getGoodsSnapshot();
        if (snap instanceof Map) {
            Object t = ((Map<?, ?>) snap).get("title");
            if (t != null && !String.valueOf(t).isEmpty()) return String.valueOf(t);
        }
        return "商品";
    }

    @Override
    public boolean review(String orderId, String openid, Integer score, List<String> tags, String content) {
        if (orderId == null || orderId.isEmpty()) throw new RuntimeException("缺少订单号");
        if (openid == null || openid.isEmpty()) throw new RuntimeException("请先登录");
        int s = score == null ? 5 : score;
        if (s < 1 || s > 5) throw new RuntimeException("评分需在 1~5 星之间");

        Order o = orderMapper.selectById(orderId);
        if (o == null) throw new RuntimeException("订单不存在");
        // 只有已完成的订单能评价：pending/meeting 还没交付，提前评价等于刷分
        if (!"completed".equals(o.getStatus())) throw new RuntimeException("订单完成后才能评价");

        boolean isBuyer = openid.equals(o.getBuyerId());
        boolean isSeller = openid.equals(o.getSellerId());
        if (!isBuyer && !isSeller) throw new RuntimeException("无权评价该订单");

        List<String> cleanTags = new ArrayList<>();
        if (tags != null) {
            for (String t : tags) {
                if (t != null && !t.trim().isEmpty()) cleanTags.add(t.trim());
                if (cleanTags.size() >= MAX_TAGS) break;
            }
        }
        String text = content == null ? "" : content.trim();
        if (text.length() > MAX_CONTENT) text = text.substring(0, MAX_CONTENT);

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("score", s);
        body.put("tags", cleanTags);
        body.put("content", text);
        body.put("createdAt", System.currentTimeMillis());
        body.put("fromOpenid", openid);
        String json;
        try {
            json = MAPPER.writeValueAsString(body);
        } catch (Exception e) {
            throw new RuntimeException("评价保存失败");
        }

        String col = isBuyer ? "buyer_review" : "seller_review";
        // 条件更新：该列仍为空才能写。连点/重复提交时第二次会更新 0 行 → 返回 false，
        // 而不是把第一条评价覆盖掉（一单一评）。
        UpdateWrapper<Order> uw = new UpdateWrapper<>();
        uw.eq("id", orderId).eq("status", "completed")
          .and(w -> w.isNull(col).or().eq(col, ""))
          .set(col, json)
          .set("updated_at", System.currentTimeMillis());
        boolean ok = orderMapper.update(null, uw) == 1;
        if (!ok) return false;

        // 信用分调整作用在**被评价人**身上：我评的是对方，加分/扣分自然是对方的。
        // 好评(4~5) +2，中评(3) 不变，差评(1~2) -3；上下限 0~100。
        int delta = s >= 4 ? 2 : (s <= 2 ? -3 : 0);
        if (delta != 0) {
            String peer = isBuyer ? o.getSellerId() : o.getBuyerId();
            if (peer != null && !peer.isEmpty()) {
                UpdateWrapper<User> uuw = new UpdateWrapper<>();
                // 用库内计算而不是「读出来 + 再写回」，避免并发评价互相覆盖
                uuw.eq("openid", peer)
                   .setSql("credit = LEAST(100, GREATEST(0, IFNULL(credit, 100) + " + delta + "))");
                userMapper.update(null, uuw);
            }
        }
        return true;
    }

    @Override
    public List<User> listPendingVerify() {
        // ⚠️ 只认「真正提交过申请」的人：verified=0 是默认值，没填过表的新用户也是 0。
        // 不加这个条件，后台会冒出一堆姓名/学号全空的幽灵申请，管理员无从审核。
        return userMapper.selectList(new QueryWrapper<User>()
                .eq("verified", 0)
                .isNotNull("verify_apply")
                .ne("verify_apply", ""));
    }

    @Override
    public boolean reviewVerify(String openid, boolean pass) {
        UpdateWrapper<User> uw = new UpdateWrapper<>();
        uw.eq("openid", openid).set("verified", pass ? 1 : 2);
        return userMapper.update(null, uw) == 1;
    }

    @Override
    public User applyVerify(String openid, Map<String, Object> req) {
        User u = getByOpenid(openid);
        if (u == null) {
            u = new User();
            u.setOpenid(openid);
            u = upsert(u);
        }
        // 真实审核流：提交后进入「待审核」队列（verified=0），由管理员在后台通过/驳回。
        // （此前是提交即自动通过，导致后台「待审核认证」永远为空，审核演示断链）
        Map<String, Object> apply = new HashMap<>();
        apply.put("status", "pending");
        apply.put("realName", req.get("realName"));
        apply.put("studentId", req.get("studentId"));
        apply.put("school", req.get("school"));
        apply.put("education", req.get("education"));
        apply.put("agreed", req.get("agreed"));
        apply.put("agreedAt", req.get("agreedAt"));
        apply.put("evidence", req.get("evidence"));
        apply.put("submittedAt", System.currentTimeMillis());
        try {
            u.setVerifyApply(new com.fasterxml.jackson.databind.ObjectMapper().writeValueAsString(apply));
        } catch (Exception e) {
            u.setVerifyApply(apply.toString());
        }
        if (req.get("realName") != null) u.setRealName(String.valueOf(req.get("realName")));
        if (req.get("studentId") != null) u.setStudentId(String.valueOf(req.get("studentId")));
        if (req.get("school") != null) u.setSchool(String.valueOf(req.get("school")));
        if (req.get("education") != null) u.setEducation(String.valueOf(req.get("education")));
        u.setVerified(0); // 待管理员审核（reviewVerify pass → 1，驳回 → 2）
        u.setUpdatedAt(System.currentTimeMillis());
        userMapper.updateById(u);
        return u;
    }
}
