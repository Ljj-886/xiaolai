package com.campus.mall.controller;

import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.campus.mall.common.Constants;
import com.campus.mall.common.PageResult;
import com.campus.mall.common.Param;
import com.campus.mall.common.R;
import com.campus.mall.common.TextUtil;
import com.campus.mall.entity.Goods;
import com.campus.mall.entity.Report;
import com.campus.mall.entity.User;
import com.campus.mall.mapper.ReportMapper;
import com.campus.mall.service.GoodsService;
import com.campus.mall.service.UserService;
import jakarta.annotation.Resource;
import org.springframework.web.bind.annotation.*;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@RestController
public class UserController {

    @Resource
    private UserService userService;

    @Resource
    private GoodsService goodsService;

    @Resource
    private ReportMapper reportMapper;

    @PostMapping("/api/user")
    public R<?> dispatch(@RequestBody Map<String, Object> req) {
        Param p = new Param(req);
        String action = p.s("action");
        if (action == null) return R.fail("缺少 action");
        String openid = p.s("openid");
        switch (action) {
            case "me": {
                User u = userService.getByOpenid(openid);
                if (u == null) {
                    u = new User();
                    u.setOpenid(openid);
                    u = userService.upsert(u);
                }
                // 管理员身份兜底校正：库里已存在的老行 is_admin 可能是 0，
                // 会导致「我的」页 wx:if="{{user.isAdmin}}" 的管理入口永远不显示。
                if (Constants.ADMIN_OPENID.equals(openid)
                        && (u.getIsAdmin() == null || u.getIsAdmin() != 1)) {
                    u.setIsAdmin(1);
                    userService.upsert(u);
                }
                return R.ok(u);
            }
            case "upsert":
            case "login": {
                User u = toUser(req);
                if (u.getOpenid() == null) u.setOpenid(openid);
                return R.ok(userService.upsert(u));
            }
            case "updateProfile": {
                // 昵称/学校/个性签名等是自由输入，带 emoji 会在教室 5.0.45 上 1366
                for (String k : new String[]{"nickName", "school", "realName", "desc",
                        "signature", "gender", "education", "studentId"}) {
                    Object v = req.get(k);
                    if (v instanceof String) req.put(k, TextUtil.stripNonBmp((String) v));
                }
                User u = userService.updateProfile(openid, req);
                return R.ok(u != null ? u : new HashMap<>());
            }
            case "toggleFav": {
                boolean faved = userService.toggleFav(openid, p.s("goodsId"));
                return R.ok(faved);
            }
            case "toggleWant": {
                boolean want = userService.toggleWant(openid, p.s("goodsId"));
                return R.ok(want);
            }
            case "getPublic": {
                return R.ok(userService.getPublic(p.s("openid") != null ? p.s("openid") : p.s("peer")));
            }
            case "myFavs": {
                long current = p.l("page") == null ? 1 : p.l("page");
                long size = p.l("pageSize") == null ? 10 : p.l("pageSize");
                Page<Goods> page = goodsService.myFavs(openid, current, size);
                return R.ok(PageResult.of(page));
            }
            case "myGoods": {
                long current = p.l("page") == null ? 1 : p.l("page");
                long size = p.l("pageSize") == null ? 10 : p.l("pageSize");
                Page<Goods> page = goodsService.myGoods(openid, p.s("status"), p.s("category"), p.s("type"), current, size);
                return R.ok(PageResult.of(page));
            }
            case "myCredit": {
                return R.ok(userService.myCredit(openid));
            }
            case "review": {
                // 评价标签是数组，Param 只取标量，这里单独从原始 body 里拿
                List<String> tags = new ArrayList<>();
                Object rawTags = p.o("tags");
                if (rawTags instanceof List) {
                    for (Object t : (List<?>) rawTags) {
                        if (t != null) tags.add(TextUtil.stripNonBmp(String.valueOf(t)));
                    }
                }
                try {
                    boolean ok = userService.review(
                            p.s("orderId") != null ? p.s("orderId") : p.s("id"),
                            openid, p.i("score"), tags, TextUtil.stripNonBmp(p.s("content")));
                    // 已评价过：一单一评，不覆盖原评价，也不当报错打断演示
                    if (!ok) return R.fail("该订单你已评价过了");
                    return R.ok(true);
                } catch (RuntimeException e) {
                    // 业务校验（未完成/无权/评分越界）转成前端能 toast 的 msg。
                    // 直接抛出去会变成 HTTP 500，小程序端只会显示「请求失败」，看不出原因。
                    return R.fail(e.getMessage() == null ? "评价失败" : e.getMessage());
                }
            }
            case "listPendingVerify": {
                // ⚠️ 后台页读的是 data.list（裸数组会让列表恒空），且每条要带 apply 对象
                // —— wxml 直接取 item.apply.realName / studentId / school / evidence，
                // 缺了就只会显示"姓名： · 学号："这种空卡片，看不出是谁在申请。
                List<User> list = userService.listPendingVerify();
                List<Map<String, Object>> rows = new ArrayList<>();
                for (User u : list) {
                    Map<String, Object> row = new HashMap<>();
                    row.put("openid", u.getOpenid());
                    row.put("_openid", u.getOpenid());
                    row.put("_id", u.getId());
                    String nick = u.getNickName();
                    if (nick == null || nick.isEmpty()) nick = u.getRealName();
                    if (nick == null || nick.isEmpty()) nick = u.getOpenid();
                    row.put("nickName", nick);
                    row.put("avatarUrl", u.getAvatarUrl() == null ? "" : u.getAvatarUrl());
                    row.put("apply", toApply(u));
                    rows.add(row);
                }
                Map<String, Object> data = new HashMap<>();
                data.put("list", rows);
                data.put("total", rows.size());
                data.put("hasMore", false);
                return R.ok(data);
            }
            case "reviewVerify": {
                boolean ok = userService.reviewVerify(p.s("targetOpenid"), p.b("pass") == Boolean.TRUE);
                return R.ok(ok);
            }
            case "applyVerify": {
                User u = userService.applyVerify(openid, req);
                return R.ok(u);
            }
            case "report": {
                // 小程序举报页提交：call('user', { action:'report', targetType, targetId, reason, desc, images })
                Report rep = new Report();
                rep.setId(UUID.randomUUID().toString().replace("-", ""));
                rep.setOpenid(openid == null ? "" : openid);
                User ru = openid != null ? userService.getByOpenid(openid) : null;
                rep.setReporterNick(ru != null && ru.getNickName() != null ? ru.getNickName() : "");
                String tt = p.s("targetType");
                rep.setTargetType(tt == null || tt.isEmpty() ? "goods" : tt);
                rep.setTargetId(p.s("targetId"));
                rep.setReason(TextUtil.stripNonBmp(p.s("reason")));
                rep.setDescription(TextUtil.stripNonBmp(p.s("desc")));
                // images 是数组，表存 JSON 文本
                Object imgs = p.o("images");
                try {
                    rep.setImages(imgs == null ? "[]" : MAPPER.writeValueAsString(imgs));
                } catch (Exception e) {
                    rep.setImages("[]");
                }
                rep.setStatus("pending");
                rep.setCreatedAt(System.currentTimeMillis());
                reportMapper.insert(rep);
                return R.ok(true);
            }
            default:
                return R.fail("未知 action: " + action);
        }
    }

    private static final com.fasterxml.jackson.databind.ObjectMapper MAPPER =
            new com.fasterxml.jackson.databind.ObjectMapper();

    /**
     * 把用户记录组装成后台认证卡片需要的 apply 对象。
     * verifyApply 是 JSON 文本（历史数据可能为空），缺字段时用 users 表字段兜底，
     * 保证「姓名/学号/学校」永远有值可审。
     */
    @SuppressWarnings("unchecked")
    private Map<String, Object> toApply(User u) {
        Map<String, Object> apply = new HashMap<>();
        String raw = u.getVerifyApply();
        if (raw != null && !raw.isEmpty()) {
            try {
                Map<String, Object> parsed = MAPPER.readValue(raw, Map.class);
                if (parsed != null) apply.putAll(parsed);
            } catch (Exception ignored) {
                // 脏 JSON：忽略，走下面的字段兜底
            }
        }
        if (isBlank(apply.get("realName"))) putIf(apply, "realName", u.getRealName());
        if (isBlank(apply.get("studentId"))) putIf(apply, "studentId", u.getStudentId());
        if (isBlank(apply.get("school"))) putIf(apply, "school", u.getSchool());
        if (isBlank(apply.get("education"))) putIf(apply, "education", u.getEducation());
        if (apply.get("evidence") == null) apply.put("evidence", new ArrayList<>());
        if (apply.get("createdAt") == null) apply.put("createdAt", u.getUpdatedAt() == null ? 0L : u.getUpdatedAt());
        return apply;
    }

    private static boolean isBlank(Object v) {
        return v == null || String.valueOf(v).trim().isEmpty();
    }

    private static void putIf(Map<String, Object> m, String k, Object v) {
        if (v != null && !String.valueOf(v).trim().isEmpty()) m.put(k, v);
    }

    private User toUser(Map<String, Object> req) {
        Param p = new Param(req);
        User u = new User();
        u.setOpenid(p.s("openid"));
        u.setNickName(p.s("nickName"));
        u.setAvatarUrl(p.s("avatarUrl"));
        u.setSchool(p.s("school"));
        u.setGender(p.s("gender"));
        u.setEducation(p.s("education"));
        u.setRealName(p.s("realName"));
        u.setStudentId(p.s("studentId"));
        return u;
    }
}
