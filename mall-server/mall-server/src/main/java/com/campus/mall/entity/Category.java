package com.campus.mall.entity;

import com.baomidou.mybatisplus.annotation.TableName;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableField;
import lombok.Data;

import java.io.Serializable;

@Data
@TableName("categories")
public class Category implements Serializable {
    @TableId
    private String id;
    /** ⚠️ key 是 MySQL 保留字：字段名必须用反引号包起来，否则生成的 SQL 报 1064 */
    @TableField("`key`")
    private String key;
    private String name;
    private String icon;          // emoji
    private Integer sort;
}
