package com.campus.mall.entity;

import com.baomidou.mybatisplus.annotation.TableName;
import com.baomidou.mybatisplus.annotation.TableId;
import lombok.Data;

import java.io.Serializable;

@Data
@TableName("reviews")
public class Review implements Serializable {
    @TableId
    private String id;
    private String openid;
    private String orderId;
    private String role;          // buyer / seller
    private Integer score;        // 1~5
    private Long createdAt;
}
