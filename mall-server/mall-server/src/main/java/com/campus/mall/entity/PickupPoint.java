package com.campus.mall.entity;

import com.baomidou.mybatisplus.annotation.TableName;
import com.baomidou.mybatisplus.annotation.TableId;
import lombok.Data;

import java.io.Serializable;

@Data
@TableName("pickup_points")
public class PickupPoint implements Serializable {
    @TableId
    private String id;
    private String name;
    private String description;
    private String campus;
    private Long createdAt;
}
