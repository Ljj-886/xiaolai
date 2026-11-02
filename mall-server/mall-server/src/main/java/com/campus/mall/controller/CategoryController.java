package com.campus.mall.controller;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.campus.mall.common.R;
import com.campus.mall.entity.Category;
import com.campus.mall.mapper.CategoryMapper;
import jakarta.annotation.Resource;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
public class CategoryController {

    @Resource
    private CategoryMapper categoryMapper;

    @PostMapping("/api/category")
    public R<?> dispatch(@RequestBody Map<String, Object> req) {
        String action = (String) req.get("action");
        if ("list".equals(action)) {
            QueryWrapper<Category> qw = new QueryWrapper<>();
            qw.orderByAsc("sort");
            List<Category> list = categoryMapper.selectList(qw);
            return R.ok(list);
        }
        return R.fail("未知 action: " + action);
    }
}
