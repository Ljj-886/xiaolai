package com.campus.mall.entity;

import com.baomidou.mybatisplus.annotation.TableName;
import com.baomidou.mybatisplus.annotation.TableId;
import lombok.Data;

import java.io.Serializable;

@Data
@TableName("users")
public class User implements Serializable {
    @TableId
    private String id;
    private String openid;
    private String nickName;
    private String avatarUrl;
    private String school;
    private String studentId;
    private String realName;
    private String gender;
    private String education;
    private Integer verified;
    private Integer credit;
    private Integer isAdmin;
    private String status;
    private Integer onSaleCount;
    private Integer soldCount;
    private Integer boughtCount;
    private Integer publishedCount;
    private Long lastActiveAt;
    private Long createdAt;
    private Long updatedAt;
    private String verifyApply;   // 认证申请对象（JSON 文本）
}
