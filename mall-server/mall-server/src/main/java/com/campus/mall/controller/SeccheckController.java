package com.campus.mall.controller;

import com.campus.mall.common.R;
import org.springframework.web.bind.annotation.*;

import java.util.HashMap;
import java.util.Map;

@RestController
public class SeccheckController {

    @PostMapping("/api/seccheck")
    public R<?> dispatch(@RequestBody Map<String, Object> req) {
        String action = (String) req.get("action");
        // 演示用：图片审核直接放行（真实环境应接内容安全 API）
        if ("imgCheck".equals(action)) {
            Map<String, Object> data = new HashMap<>();
            data.put("safe", true);
            data.put("label", "ok");
            return R.ok(data);
        }
        return R.fail("未知 action: " + action);
    }
}
