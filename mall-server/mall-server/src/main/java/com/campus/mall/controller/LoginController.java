package com.campus.mall.controller;

import com.campus.mall.common.Constants;
import com.campus.mall.common.R;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.HashMap;
import java.util.Map;

/**
 * 登录。Java 模式下没有微信云上下文，无法拿到真实 OPENID，
 * 这里固定返回一个稳定的演示身份（与云开发演示身份互不干扰）。
 * 小程序 app.js 的 initUser() 会把返回的 openid 存进本地缓存，
 * 后续所有请求都由 cloud.js 适配器自动带上。
 */
@RestController
@RequestMapping("/api/login")
public class LoginController {

    // 固定的演示用户，保证发布/下单/我的商品都在同一身份下，方便课堂演示
    private static final String DEMO_OPENID = "oLocalDemoUser";

    @PostMapping
    public R<?> login(@RequestBody(required = false) Map<String, Object> body) {
        String openid = null;
        if (body != null && body.get("openid") != null) {
            openid = String.valueOf(body.get("openid"));
        }
        if (openid == null || openid.isEmpty()) {
            openid = DEMO_OPENID;
        }

        Map<String, Object> userInfo = new HashMap<>();
        userInfo.put("openid", openid);
        userInfo.put("_openid", openid);
        userInfo.put("nickName", "演示同学");
        userInfo.put("avatarUrl", "");
        // 演示版：固定身份即管理员（满足「只有我一个人能审核」），前端据此显示管理入口
        userInfo.put("isAdmin", Constants.ADMIN_OPENID.equals(openid) ? 1 : 0);

        Map<String, Object> data = new HashMap<>();
        data.put("openid", openid);
        data.put("userInfo", userInfo);

        return R.ok(data);
    }
}
