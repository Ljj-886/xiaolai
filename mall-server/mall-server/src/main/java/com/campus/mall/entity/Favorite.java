package com.campus.mall.entity;

import com.baomidou.mybatisplus.annotation.TableName;
import com.baomidou.mybatisplus.annotation.TableId;
import lombok.Data;

import java.io.Serializable;

@Data
@TableName("favorites")
public class Favorite implements Serializable {
    @TableId
    private String id;            // openid_goodsId
    private String openid;
    private String goodsId;
    private Long createdAt;
}
