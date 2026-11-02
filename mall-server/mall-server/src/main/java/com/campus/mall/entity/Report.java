package com.campus.mall.entity;

import com.baomidou.mybatisplus.annotation.TableName;
import com.baomidou.mybatisplus.annotation.TableId;
import lombok.Data;

import java.io.Serializable;

@Data
@TableName("reports")
public class Report implements Serializable {
    @TableId
    private String id;
    private String openid;
    private String reporterNick;
    private String targetType;    // goods / user
    private String targetId;
    private String reason;
    private String description;
    private String images;        // 凭证图（JSON 文本）
    private String status;
    private Long createdAt;
}
