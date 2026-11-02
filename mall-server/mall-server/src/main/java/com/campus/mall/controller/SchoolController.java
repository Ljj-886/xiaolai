package com.campus.mall.controller;

import com.campus.mall.common.R;
import org.springframework.web.bind.annotation.*;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

@RestController
public class SchoolController {

    @PostMapping("/api/school")
    public R<?> dispatch(@RequestBody Map<String, Object> req) {
        String action = (String) req.get("action");
        if ("list".equals(action)) {
            List<Map<String, Object>> list = new ArrayList<>();
            list.add(school("szu", "深圳大学", "深圳"));
            list.add(school("pk", "北京大学", "北京"));
            list.add(school("thu", "清华大学", "北京"));
            list.add(school("sysu", "中山大学", "广州"));
            return R.ok(list);
        }
        return R.fail("未知 action: " + action);
    }

    private Map<String, Object> school(String id, String name, String city) {
        Map<String, Object> m = new HashMap<>();
        m.put("id", id);
        m.put("name", name);
        m.put("city", city);
        return m;
    }
}
