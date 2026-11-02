package com.campus.mall.common;

import com.baomidou.mybatisplus.extension.plugins.pagination.Page;

import java.util.HashMap;
import java.util.Map;

/**
 * 分页结果统一出口。
 *
 * <p>⚠️ 背景（Java 演示模式最隐蔽的一个坑）：MyBatis-Plus 的 Page 序列化出来是
 * {@code records / total}，而小程序所有列表页读的是 {@code list / hasMore}。
 * 口径不一致时前端 {@code (data.list || [])} 恒为空数组 —— **不报错、不提示，
 * 页面就是一片空白**，极易被误判成"没有数据"或"前端 bug"。
 * 首页、我的商品、收藏、后台四个列表都栽在这里。
 *
 * <p>所以：凡是返回分页的 action，一律走 {@link #of(Page)}，同时输出两套字段。
 */
public class PageResult {

    public static Map<String, Object> of(Page<?> page) {
        Map<String, Object> m = new HashMap<>();
        m.put("list", page.getRecords());
        m.put("records", page.getRecords());
        m.put("total", page.getTotal());
        m.put("page", page.getCurrent());
        m.put("pageSize", page.getSize());
        m.put("hasMore", page.getCurrent() * page.getSize() < page.getTotal());
        return m;
    }

    /** 非分页的列表（如举报/日志）：后台页同样读 data.list，不能返回裸数组 */
    public static Map<String, Object> of(java.util.Collection<?> list) {
        Map<String, Object> m = new HashMap<>();
        m.put("list", list);
        m.put("total", list.size());
        m.put("hasMore", false);
        return m;
    }

    /**
     * 手动分页（后台列表在 DB 分页后还要加工字段时用）：
     * 保留 total / hasMore，否则后台「加载更多」会失效。
     */
    public static Map<String, Object> of(java.util.Collection<?> list, long total, long page, long pageSize) {
        Map<String, Object> m = new HashMap<>();
        m.put("list", list);
        m.put("records", list);
        m.put("total", total);
        m.put("page", page);
        m.put("pageSize", pageSize);
        m.put("hasMore", page * pageSize < total);
        return m;
    }
}
