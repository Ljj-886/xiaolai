package com.campus.mall.entity;

import com.baomidou.mybatisplus.annotation.TableName;
import com.baomidou.mybatisplus.annotation.TableId;
import lombok.Data;

import java.io.Serializable;

@Data
@TableName("conversations")
public class Conversation implements Serializable {
    @TableId
    private String id;            // = openidA_openidB_goodsId
    private String participants;  // openid 数组（JSON 文本）
    private String personA;
    private String personB;
    private String goodsId;
    private String goodsSnapshot; // 商品快照（JSON 文本）
    private String lastMessage;
    private Long lastMessageAt;
    private String unread;        // {openid: count}（JSON 文本）
    private Long createdAt;
    private Long updatedAt;
}
