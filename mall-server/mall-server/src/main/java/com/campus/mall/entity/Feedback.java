package com.campus.mall.entity;

import com.baomidou.mybatisplus.annotation.TableName;
import com.baomidou.mybatisplus.annotation.TableId;
import lombok.Data;

import java.io.Serializable;

@Data
@TableName("feedback")
public class Feedback implements Serializable {
    @TableId
    private String id;
    private String openid;
    private String nickName;
    private String school;
    private String campus;
    private String kind;          // suggest/bug/report/other
    private String content;
    private String contact;
    private String images;        // 图片（JSON 文本）
    private String status;        // pending/resolved/rejected
    private String handlerNote;
    private Long handledAt;
    private Long createdAt;
}
