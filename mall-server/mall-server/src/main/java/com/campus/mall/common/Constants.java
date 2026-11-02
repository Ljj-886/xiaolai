package com.campus.mall.common;

/**
 * 演示版全局常量。
 *
 * <p>ADMIN_OPENID：唯一的演示管理员身份。Java 演示模式下 LoginController 固定返回
 * 这个 openid（没有真实微信鉴权），因此「只有这一个人能审核」= 仅此 openid 可调管理接口。
 * 真实上线时请把管理员判定改为读 users.is_admin 列或接入权限系统。</p>
 */
public final class Constants {
    /** 演示版唯一管理员 openid（与 LoginController.DEMO_OPENID 保持一致） */
    public static final String ADMIN_OPENID = "oLocalDemoUser";

    private Constants() {}
}
