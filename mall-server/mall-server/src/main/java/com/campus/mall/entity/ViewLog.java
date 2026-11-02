package com.campus.mall.entity;

import com.baomidou.mybatisplus.annotation.TableName;
import com.baomidou.mybatisplus.annotation.TableId;
import lombok.Data;

import java.io.Serializable;

@Data
@TableName("view_logs")
public class ViewLog implements Serializable {
    @TableId
    private String id;            // openid_goodsId（去重浏览量）
    private String openid;
    private String goodsId;
    private Long createdAt;
}
