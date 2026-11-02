package com.campus.mall.controller;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.core.conditions.update.UpdateWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.campus.mall.common.PageResult;
import com.campus.mall.common.Param;
import com.campus.mall.common.R;
import com.campus.mall.entity.Feedback;
import com.campus.mall.mapper.FeedbackMapper;
import jakarta.annotation.Resource;
import org.springframework.web.bind.annotation.*;

import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

@RestController
public class FeedbackController {

    @Resource
    private FeedbackMapper feedbackMapper;

    @PostMapping("/api/feedback")
    public R<?> dispatch(@RequestBody Map<String, Object> req) {
        Param p = new Param(req);
        String action = p.s("action");
        if (action == null) return R.fail("缺少 action");
        switch (action) {
            case "submit": {
                Feedback f = new Feedback();
                f.setId(UUID.randomUUID().toString().replace("-", ""));
                f.setOpenid(p.s("openid"));
                f.setNickName(p.s("nickName"));
                f.setSchool(p.s("school"));
                f.setCampus(p.s("campus"));
                f.setKind(p.s("kind"));
                f.setContent(p.s("content"));
                f.setContact(p.s("contact"));
                f.setImages(p.s("images"));
                f.setStatus("pending");
                f.setCreatedAt(System.currentTimeMillis());
                feedbackMapper.insert(f);
                return R.ok(f);
            }
            case "list": {
                long current = p.l("page") == null ? 1 : p.l("page");
                long size = p.l("pageSize") == null ? 20 : p.l("pageSize");
                QueryWrapper<Feedback> qw = new QueryWrapper<>();
                if (p.s("status") != null && !p.s("status").isEmpty()) qw.eq("status", p.s("status"));
                qw.orderByDesc("created_at");
                return R.ok(PageResult.of(feedbackMapper.selectPage(new Page<>(current, size), qw)));
            }
            case "handle": {
                UpdateWrapper<Feedback> uw = new UpdateWrapper<>();
                uw.eq("id", p.s("id")).set("status", p.s("status"))
                  .set("handled_at", System.currentTimeMillis());
                if (p.s("note") != null) uw.set("handler_note", p.s("note"));
                return R.ok(feedbackMapper.update(null, uw) == 1);
            }
            default:
                return R.fail("未知 action: " + action);
        }
    }
}
