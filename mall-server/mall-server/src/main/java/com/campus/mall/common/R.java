package com.campus.mall.common;

import lombok.Data;

import java.io.Serializable;

/**
 * 统一响应信封，对应小程序云函数里 { code, data, msg } 的风格：
 *   成功：R.ok(data)
 *   失败：R.fail("错误信息")
 */
@Data
public class R<T> implements Serializable {
    private int code;
    private String msg;
    private T data;

    public static <T> R<T> ok(T data) {
        R<T> r = new R<>();
        r.code = 0;
        r.msg = "ok";
        r.data = data;
        return r;
    }

    public static <T> R<T> ok() {
        return ok(null);
    }

    public static <T> R<T> fail(String msg) {
        R<T> r = new R<>();
        r.code = 1;
        r.msg = msg;
        return r;
    }

    /** 对应小程序里带错误码的场景（如 403 无权限） */
    public static <T> R<T> fail(int code, String msg) {
        R<T> r = new R<>();
        r.code = code;
        r.msg = msg;
        return r;
    }
}
