package com.campus.mall.common;

import java.util.Map;

/**
 * 从小程序透传来的 JSON body（Map）里取参的小工具。
 * 云函数原本靠 wx 上下文自动拿 OPENID、靠 doc._id 取主键；
 * Java 后端没有这些上下文，参数都由小程序显式传，这里统一做类型转换。
 */
public class Param {
    private final Map<String, Object> m;

    public Param(Map<String, Object> m) {
        this.m = m;
    }

    public String s(String k) {
        Object v = m.get(k);
        return v == null ? null : String.valueOf(v);
    }

    public Long l(String k) {
        Object v = m.get(k);
        if (v == null) return null;
        if (v instanceof Number) return ((Number) v).longValue();
        try {
            return Long.parseLong(v.toString());
        } catch (Exception e) {
            return null;
        }
    }

    public Integer i(String k) {
        Object v = m.get(k);
        if (v == null) return null;
        if (v instanceof Number) return ((Number) v).intValue();
        try {
            return Integer.parseInt(v.toString());
        } catch (Exception e) {
            return null;
        }
    }

    public Boolean b(String k) {
        Object v = m.get(k);
        if (v == null) return null;
        if (v instanceof Boolean) return (Boolean) v;
        String s = v.toString();
        return "true".equalsIgnoreCase(s) || "1".equals(s) || "yes".equalsIgnoreCase(s);
    }

    public Object o(String k) {
        return m.get(k);
    }
}
