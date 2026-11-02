package com.campus.mall.config;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.ResourceHandlerRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

import java.nio.file.Paths;

/**
 * 把上传目录映射成静态资源，让小程序能直接 <image src="http://host:9090/files/xxx.jpg"> 访问。
 * 与 /api/** 业务接口互不冲突（前缀不同）。
 */
@Configuration
public class WebConfig implements WebMvcConfigurer {

    @Value("${file.upload-dir:./uploads}")
    private String uploadDir;

    @Override
    public void addResourceHandlers(ResourceHandlerRegistry registry) {
        // Windows 路径转成 file:///C:/.../ 形式，Spring 的 ResourceHttpRequestHandler 才认
        String abs = Paths.get(uploadDir).toAbsolutePath().normalize().toString().replace('\\', '/');
        String location = "file:///" + abs + "/";
        registry.addResourceHandler("/files/**")
                .addResourceLocations(location);
    }
}
