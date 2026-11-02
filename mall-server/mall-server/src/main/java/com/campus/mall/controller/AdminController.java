package com.campus.mall.controller;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.core.conditions.update.UpdateWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.campus.mall.common.Constants;
import com.campus.mall.common.PageResult;
import com.campus.mall.common.Param;
import com.campus.mall.common.R;
import com.campus.mall.entity.Category;
import com.campus.mall.entity.Favorite;
import com.campus.mall.entity.Feedback;
import com.campus.mall.entity.Goods;
import com.campus.mall.entity.Report;
import com.campus.mall.entity.User;
import com.campus.mall.entity.Want;
import com.campus.mall.mapper.CategoryMapper;
import com.campus.mall.mapper.FavoriteMapper;
import com.campus.mall.mapper.FeedbackMapper;
import com.campus.mall.mapper.GoodsMapper;
import com.campus.mall.mapper.OrderMapper;
import com.campus.mall.mapper.ReportMapper;
import com.campus.mall.mapper.UserMapper;
import com.campus.mall.mapper.WantMapper;
import com.campus.mall.service.GoodsService;
import jakarta.annotation.Resource;
import org.springframework.web.bind.annotation.*;

import java.util.*;

@RestController
public class AdminController {

    @Resource private GoodsMapper goodsMapper;
    @Resource private UserMapper userMapper;
    @Resource private OrderMapper orderMapper;
    @Resource private ReportMapper reportMapper;
    @Resource private CategoryMapper categoryMapper;
    @Resource private FeedbackMapper feedbackMapper;
    @Resource private FavoriteMapper favoriteMapper;
    @Resource private WantMapper wantMapper;
    @Resource private GoodsService goodsService;

    @PostMapping("/api/admin")
    public R<?> dispatch(@RequestBody Map<String, Object> req) {
        Param p = new Param(req);
        String action = p.s("action");
        if (action == null) return R.fail("缺少 action");
        // ⚠️ 仅管理员可访问：满足「只有我一个人能审核」。
        // 演示版管理员 = Constants.ADMIN_OPENID（固定演示身份），适配器会自动带上该 openid。
        // 「初始化」只是灌分类字典数据，无敏感操作，允许在成为管理员之前调用（否则永远没法初始化）
        if (!"init".equals(action) && !Constants.ADMIN_OPENID.equals(p.s("openid"))) {
            return R.fail("无权限：仅管理员可操作");
        }
        switch (action) {
            case "stats": {
                Map<String, Object> stats = new HashMap<>();
                long pendingGoods = goodsMapper.selectCount(new QueryWrapper<Goods>().eq("status", "pending"));
                stats.put("goodsOnSale", goodsMapper.selectCount(new QueryWrapper<Goods>().eq("status", "onSale")));
                stats.put("goodsPending", pendingGoods);
                stats.put("pendingGoods", pendingGoods);
                // 口径必须与 listPendingVerify 一致：只数「提交过申请且未审核」的，
                // 否则统计显示 3 条、点进去列表是空的（verified=0 是所有新用户的默认值）
                stats.put("pendingVerify", userMapper.selectCount(new QueryWrapper<User>()
                        .eq("verified", 0)
                        .isNotNull("verify_apply")
                        .ne("verify_apply", "")));
                stats.put("recheckGoods", goodsMapper.selectCount(new QueryWrapper<Goods>().eq("recheck", 1)));
                // 举报链路已打通，这里必须查真实数量：写死 0 会出现
                // 「后台首页显示 0 条，点进去列表却有记录」的自相矛盾。
                stats.put("pendingReports", reportMapper.selectCount(
                        new QueryWrapper<Report>().eq("status", "pending")));
                stats.put("goodsOff", goodsMapper.selectCount(new QueryWrapper<Goods>().eq("status", "off")));
                stats.put("goodsBanned", goodsMapper.selectCount(new QueryWrapper<Goods>().eq("status", "banned")));
                stats.put("users", userMapper.selectCount(null));
                stats.put("orders", orderMapper.selectCount(null));
                return R.ok(stats);
            }
            case "listGoods": {
                long current = p.l("page") == null ? 1 : p.l("page");
                long size = p.l("pageSize") == null ? 20 : p.l("pageSize");
                QueryWrapper<Goods> qw = new QueryWrapper<>();
                String status = p.s("status");
                // ⚠️ tab 里的 recheck / all 不是状态值：直接当 status 过滤会恒空（且不报错）
                if ("recheck".equals(status)) qw.eq("recheck", 1);
                else if (status != null && !status.isEmpty() && !"all".equals(status)) qw.eq("status", status);
                if (p.s("keyword") != null && !p.s("keyword").isEmpty()) qw.like("title", p.s("keyword"));
                qw.orderByDesc("created_at");
                return R.ok(PageResult.of(goodsMapper.selectPage(new Page<>(current, size), qw)));
            }
            case "listUsers": {
                long current = p.l("page") == null ? 1 : p.l("page");
                long size = p.l("pageSize") == null ? 20 : p.l("pageSize");
                QueryWrapper<User> qw = new QueryWrapper<>();
                if (p.s("keyword") != null && !p.s("keyword").isEmpty()) qw.like("nick_name", p.s("keyword"));
                qw.orderByDesc("created_at");
                return R.ok(PageResult.of(userMapper.selectPage(new Page<>(current, size), qw)));
            }
            case "recheck": {
                String decision = p.s("decision");
                boolean ok = goodsService.updateStatus(p.s("id"), decision, null, p.s("note"));
                return R.ok(ok);
            }
            case "reviewGoods": {
                if (p.b("pass") == Boolean.TRUE) {
                    return R.ok(goodsService.updateStatus(p.s("id"), "onSale", null, null));
                } else {
                    return R.ok(goodsService.updateStatus(p.s("id"), "off", "reviewReject", p.s("reason")));
                }
            }
            // 小程序二次审核按钮发的是 recheckGoods（此前后端只有 recheck → 会报「未知 action」）
            case "recheckGoods": {
                String decision = p.s("decision");
                if (decision == null || decision.isEmpty()) decision = "onSale";
                return R.ok(goodsService.updateStatus(p.s("id"), decision, null, p.s("note")));
            }
            case "adminOff": {
                return R.ok(goodsService.updateStatus(p.s("id"), "off", "admin", p.s("reason")));
            }
            case "banGoods": {
                return R.ok(goodsService.updateStatus(p.s("id"), "banned", "ban", p.s("reason")));
            }
            case "adminBan": {
                UpdateWrapper<User> uw = new UpdateWrapper<>();
                uw.eq("openid", p.s("openid")).set("status", "banned");
                return R.ok(userMapper.update(null, uw) == 1);
            }
            case "adminUnban": {
                UpdateWrapper<User> uw = new UpdateWrapper<>();
                uw.eq("openid", p.s("openid")).set("status", "active");
                return R.ok(userMapper.update(null, uw) == 1);
            }
            // 彻底删除商品（物理删除，不可恢复）。日常管理请用 adminOff / banGoods 保留记录。
            case "deleteGoods": {
                String id = p.s("id");
                if (id == null || id.isEmpty()) return R.fail("缺少商品 id");
                // 连带清理收藏/想要，避免 myFavs 里出现 0 条商品的空占位
                favoriteMapper.delete(new QueryWrapper<Favorite>().eq("goods_id", id));
                wantMapper.delete(new QueryWrapper<Want>().eq("goods_id", id));
                return R.ok(goodsMapper.deleteById(id) == 1);
            }
            case "clearUser": {
                String openid = p.s("openid");
                goodsMapper.delete(new QueryWrapper<Goods>().eq("openid", openid));
                userMapper.delete(new QueryWrapper<User>().eq("openid", openid));
                return R.ok(true);
            }
            case "pendingReports": {
                long current = p.l("page") == null ? 1 : p.l("page");
                long size = p.l("pageSize") == null ? 20 : p.l("pageSize");
                String status = p.s("status");
                QueryWrapper<Report> qw = new QueryWrapper<>();
                // 后台页：archive='pending' 传 'pending'；切「已处理」传 'all'
                if (status != null && !status.isEmpty() && !"all".equals(status)) {
                    qw.eq("status", status);
                }
                qw.orderByDesc("created_at");
                Page<Report> pg = reportMapper.selectPage(new Page<>(current, size), qw);

                // 补齐后台要显示的字段：被举报商品的标题/封面/卖家/状态，
                // 否则 canJumpGoods 恒为 false，管理员点不进被举报商品。
                List<Map<String, Object>> rows = new ArrayList<>();
                for (Report rep : pg.getRecords()) {
                    Map<String, Object> row = new HashMap<>();
                    row.put("id", rep.getId());
                    row.put("openid", rep.getOpenid());
                    row.put("reporterNick", rep.getReporterNick());
                    row.put("targetType", rep.getTargetType());
                    row.put("targetId", rep.getTargetId());
                    row.put("reason", rep.getReason());
                    // 后台 wxml 同时用了 desc 和 description，两个都给
                    row.put("desc", rep.getDescription());
                    row.put("description", rep.getDescription());
                    row.put("images", rep.getImages());
                    row.put("status", rep.getStatus());
                    row.put("createdAt", rep.getCreatedAt());
                    if ("goods".equals(rep.getTargetType())
                            && rep.getTargetId() != null && !rep.getTargetId().isEmpty()) {
                        Goods g = goodsMapper.selectById(rep.getTargetId());
                        if (g != null) {
                            row.put("goodsTitle", g.getTitle());
                            row.put("goodsCover", g.getCover());
                            row.put("goodsSeller", g.getOpenid());
                            row.put("goodsStatus", g.getStatus());
                        }
                    }
                    rows.add(row);
                }
                return R.ok(PageResult.of(rows, pg.getTotal(), pg.getCurrent(), pg.getSize()));
            }
            case "adminLogs":
                // 后台页读的是 data.list，不能返回裸数组（否则列表恒空）
                return R.ok(PageResult.of(Collections.emptyList()));
            case "handleReport": {
                String id = p.s("id");
                if (id == null || id.isEmpty()) return R.fail("缺少 id");
                Report rep = reportMapper.selectById(id);
                boolean pass = p.b("pass") == Boolean.TRUE;
                // reOpenReport 会直接传 status='pending' 重新打开
                String st = p.s("status");
                if (st == null || st.isEmpty()) st = pass ? "resolved" : "rejected";

                // 采纳举报才执行处置动作，让举报真正产生效果（不只是改个状态）
                if (pass && rep != null) {
                    String ha = p.s("handleAction");
                    if ("off_goods".equals(ha) && "goods".equals(rep.getTargetType())
                            && rep.getTargetId() != null && !rep.getTargetId().isEmpty()) {
                        long now = System.currentTimeMillis();
                        UpdateWrapper<Goods> guw = new UpdateWrapper<>();
                        guw.eq("id", rep.getTargetId())
                           .set("status", "off")
                           .set("off_type", "report")
                           .set("off_reason", "举报核实后下架")
                           .set("off_at", now)
                           .set("recheck", 1)
                           .set("updated_at", now);
                        goodsMapper.update(null, guw);
                    } else if ("ban_user".equals(ha)
                            && rep.getTargetId() != null && !rep.getTargetId().isEmpty()) {
                        UpdateWrapper<User> uuw = new UpdateWrapper<>();
                        uuw.eq("openid", rep.getTargetId()).set("status", "banned");
                        userMapper.update(null, uuw);
                    }
                }
                UpdateWrapper<Report> ruw = new UpdateWrapper<>();
                ruw.eq("id", id).set("status", st);
                reportMapper.update(null, ruw);
                return R.ok(true);
            }
            case "init": {
                long cnt = categoryMapper.selectCount(null);
                if (cnt == 0) {
                    for (Category c : defaultCategories()) categoryMapper.insert(c);
                }
                return R.ok(true);
            }
            default:
                return R.fail("未知 action: " + action);
        }
    }

    private List<Category> defaultCategories() {
        String[][] data = {
            {"book", "图书", "\uD83D\uDCDA", "1"},
            {"digital", "数码", "\uD83D\uDCBB", "2"},
            {"daily", "日用", "\uD83E\uDDF4", "3"},
            {"sports", "运动", "⚽", "4"},
            {"ticket", "票券", "\uD83C\uDFAB", "5"},
            {"parttime", "兼职", "\uD83D\uDCBC", "6"},
            {"lost", "失物", "\uD83D\uDD0D", "7"},
            {"other", "其他", "\uD83D\uDCE6", "99"},
        };
        List<Category> list = new ArrayList<>();
        for (String[] d : data) {
            Category c = new Category();
            c.setId("cat_" + d[0]);
            c.setKey(d[0]);
            c.setName(d[1]);
            c.setIcon(d[2]);
            c.setSort(Integer.parseInt(d[3]));
            list.add(c);
        }
        return list;
    }
}
