package com.campus.mall.entity;

import com.baomidou.mybatisplus.annotation.TableName;
import com.baomidou.mybatisplus.annotation.TableId;
import lombok.Data;

import java.io.Serializable;

@Data
@TableName("admin_logs")
public class AdminLog implements Serializable {
    @TableId
    private String id;
    private String action;
    private String targetOpenid;
    private String targetId;
    private String targetType;
    private String operator;
    private String reason;
    private Integer removed;
    private Integer pass;
    private String decision;
    private String note;
    private String handleAction;
    private Long createdAt;
}
