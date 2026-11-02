package com.campus.mall.controller;

import com.campus.mall.common.R;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

/**
 * 图片上传（Java 演示模式专用）。
 *
 * 云开发模式下图片走微信云存储（wx.cloud.uploadFile），返回 cloud:// fileID。
 * 但教室里跑的是自有 Spring Boot 后端，没有云存储，所以小程序在 java 模式下改走
 * wx.uploadFile 把图片 POST 到这里，后端落盘到 file.upload-dir，再回一个能直接
 * <image src> 访问的 URL（/files/xxx.jpg），由小程序拼上后端 host 使用。
 */
@RestController
@RequestMapping("/api/upload")
public class UploadController {

    @Value("${file.upload-dir:./uploads}")
    private String uploadDir;

    // 仅放行图片格式，避免有人传 .jsp / .exe 等可执行文件到服务器目录
    private static final String[] ALLOWED = {".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"};

    @PostMapping(consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public R<?> upload(@RequestParam("file") MultipartFile file) {
        if (file == null || file.isEmpty()) {
            return R.fail("未收到文件");
        }
        String original = file.getOriginalFilename();
        String ext = "";
        if (original != null && original.indexOf('.') >= 0) {
            ext = original.substring(original.lastIndexOf('.')).toLowerCase();
        }
        boolean ok = false;
        for (String a : ALLOWED) {
            if (a.equals(ext)) { ok = true; break; }
        }
        if (!ok) {
            return R.fail("不支持的图片格式：" + (ext.isEmpty() ? "未知" : ext));
        }
        try {
            Path dir = Paths.get(uploadDir).toAbsolutePath().normalize();
            Files.createDirectories(dir);
            String name = System.currentTimeMillis() + "_"
                    + UUID.randomUUID().toString().replace("-", "").substring(0, 8) + ext;
            Path target = dir.resolve(name).normalize();
            // 防目录穿越：解析后的目标必须仍在 upload 目录内
            if (!target.startsWith(dir)) {
                return R.fail("非法上传路径");
            }
            file.transferTo(target);
            Map<String, Object> data = new HashMap<>();
            // 返回相对路径，由小程序拼上后端 host，保证手机真机预览（局域网 IP）也能用
            data.put("url", "/files/" + name);
            return R.ok(data);
        } catch (IOException e) {
            return R.fail("文件保存失败：" + e.getMessage());
        }
    }
}
