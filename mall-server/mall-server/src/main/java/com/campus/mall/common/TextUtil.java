package com.campus.mall.common;

/**
 * 文本清洗工具。
 *
 * <p>教室机房的 MySQL 5.0.45 只支持 3 字节 utf8（没有 utf8mb4），写入 4 字节字符
 * （emoji、部分生僻字）会直接抛 {@code Incorrect string value: '\xF0\x9F\x98\x80'...}
 * 导致整个接口 500，小程序端只能看到「请求失败」。
 *
 * <p>演示时学生很容易在聊天/评价/商品描述里随手打一个表情，一发就崩，整条演示流程
 * 断在这里很难当场排查。所以这里在**写入前**把非 BMP 字符（代理对）剔除：
 * 最坏情况只是丢掉那个表情，接口照常成功，流程不断。
 *
 * <p>注意：本机 3306 是 MySQL 8.0（能存 emoji），加了清洗后本机也会丢表情——
 * 这是刻意的，保证「本机跑得通」等价于「教室跑得通」，不会到了教室才发现存不进去。
 */
public final class TextUtil {

    private TextUtil() {
    }

    /**
     * 去掉字符串里的 4 字节字符（emoji 等），保留其余内容。
     * 传 null 返回 null，空串原样返回。
     */
    public static String stripNonBmp(String s) {
        if (s == null || s.isEmpty()) return s;
        StringBuilder sb = new StringBuilder(s.length());
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            // 高低代理对成对出现表示一个 U+FFFF 以上字符，整对跳过
            if (Character.isHighSurrogate(c) || Character.isLowSurrogate(c)) continue;
            sb.append(c);
        }
        return sb.toString();
    }
}
