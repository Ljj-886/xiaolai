package com.campus.mall.entity;

import com.baomidou.mybatisplus.annotation.TableName;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableField;
import lombok.Data;

import java.io.Serializable;

@Data
@TableName("messages")
public class Message implements Serializable {
    @TableId
    private String id;
    private String openid;       // 发送者
    private String convId;
    private String type;          // text / image
    private String content;
    /** ⚠️ read 是 MySQL 保留字：必须加反引号，否则 SQL 报 1064 */
    @TableField("`read`")
    private Integer read;
    private Long createdAt;
}
