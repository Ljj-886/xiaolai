package com.campus.mall.entity;

import com.baomidou.mybatisplus.annotation.TableName;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableField;
import lombok.Data;

import java.io.Serializable;
import java.math.BigDecimal;

@Data
@TableName("goods")
public class Goods implements Serializable {
    @TableId
    private String id;
    private String openid;
    private String title;
    private String description;
    private String images;        // 图片 fileID 数组（JSON 文本）
    private String cover;
    private BigDecimal price;
    private BigDecimal originalPrice;
    private String category;
    /** ⚠️ condition 是 MySQL 保留字：必须加反引号，否则 SQL 报 1064 */
    @TableField("`condition`")
    private String condition;
    private String campus;
    private String pickupPoint;
    private String type;          // sell / want
    private String status;        // pending/onSale/off/sold/reserved/banned
    private Long reviewedAt;
    private String imgCheckStatus;
    private Integer viewCount;
    private Integer favCount;
    private Integer wantCount;
    private String offType;
    private String offReason;
    private Long offAt;
    private String offBy;
    private Integer recheck;
    private Long recheckAt;
    private String banReason;
    private Long bannedAt;
    private Integer checkRetries;
    private Long createdAt;
    private Long updatedAt;
}
