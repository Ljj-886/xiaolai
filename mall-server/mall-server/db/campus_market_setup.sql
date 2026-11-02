CREATE DATABASE IF NOT EXISTS campus_market DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
USE campus_market;
-- MySQL dump 10.13  Distrib 8.0.41, for Win64 (x86_64)
--
-- Host: localhost    Database: campus_market
-- ------------------------------------------------------
-- Server version	8.0.41

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!50503 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;

--
-- Table structure for table `admin_logs`
--

DROP TABLE IF EXISTS `admin_logs`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `admin_logs` (
  `id` varchar(64) NOT NULL COMMENT '云文档 _id',
  `action` varchar(40) DEFAULT '' COMMENT '操作类型：clearUser/forceUnverify/adminOff/banGoods/recheckGoods/reviewGoods/adminBan/handleReport/viewSensitive:...',
  `target_openid` varchar(64) DEFAULT NULL COMMENT '目标用户 openid',
  `target_id` varchar(64) DEFAULT NULL COMMENT '目标对象 id（商品/举报）',
  `target_type` varchar(10) DEFAULT NULL COMMENT '目标类型',
  `operator` varchar(64) DEFAULT '' COMMENT '操作人 openid',
  `reason` varchar(200) DEFAULT NULL COMMENT '操作原因',
  `removed` int DEFAULT NULL COMMENT '被移除数量（clearUser 用）',
  `pass` tinyint(1) DEFAULT NULL COMMENT '是否通过（审核类）',
  `decision` varchar(20) DEFAULT NULL COMMENT '复审决定',
  `note` varchar(200) DEFAULT '' COMMENT '备注',
  `handle_action` varchar(20) DEFAULT NULL COMMENT '举报处理动作',
  `created_at` bigint DEFAULT '0' COMMENT '操作时间',
  PRIMARY KEY (`id`),
  KEY `idx_action` (`action`),
  KEY `idx_operator` (`operator`,`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='后台操作日志表';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `admin_logs`
--

LOCK TABLES `admin_logs` WRITE;
/*!40000 ALTER TABLE `admin_logs` DISABLE KEYS */;
/*!40000 ALTER TABLE `admin_logs` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `categories`
--

DROP TABLE IF EXISTS `categories`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `categories` (
  `id` varchar(64) NOT NULL COMMENT '云文档 _id',
  `key` varchar(20) NOT NULL COMMENT '分类 key（book/digital/...）',
  `name` varchar(20) NOT NULL COMMENT '中文名',
  `icon` varchar(8) DEFAULT '' COMMENT 'emoji 图标',
  `sort` int DEFAULT '99' COMMENT '排序',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_key` (`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='商品分类表';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `categories`
--

LOCK TABLES `categories` WRITE;
/*!40000 ALTER TABLE `categories` DISABLE KEYS */;
INSERT INTO `categories` VALUES ('cat_book','book','图书','📚',1),('cat_daily','daily','日用','🧴',3),('cat_digital','digital','数码','💻',2),('cat_lost','lost','失物','🔍',7),('cat_other','other','其他','📦',99),('cat_parttime','parttime','兼职','💼',6),('cat_sports','sports','运动','⚽',4),('cat_ticket','ticket','票券','🎫',5);
/*!40000 ALTER TABLE `categories` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `conversations`
--

DROP TABLE IF EXISTS `conversations`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `conversations` (
  `id` varchar(100) NOT NULL COMMENT '会话 id = openidA_openidB_goodsId',
  `participants` longtext COMMENT '参与者 openid 数组（2人）',
  `person_a` varchar(64) DEFAULT '' COMMENT '较小 openid',
  `person_b` varchar(64) DEFAULT '' COMMENT '较大 openid',
  `goods_id` varchar(64) DEFAULT '' COMMENT '关联商品 id',
  `goods_snapshot` longtext COMMENT '商品快照：{title,cover,price}',
  `last_message` varchar(500) DEFAULT '' COMMENT '最后一条消息预览',
  `last_message_at` bigint DEFAULT '0' COMMENT '最后消息时间',
  `unread` longtext COMMENT '未读计数：{openid: count}',
  `created_at` bigint DEFAULT '0' COMMENT '创建时间',
  `updated_at` bigint DEFAULT '0' COMMENT '更新时间',
  PRIMARY KEY (`id`),
  KEY `idx_participants` (`person_a`,`person_b`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='私信会话表';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `conversations`
--

LOCK TABLES `conversations` WRITE;
/*!40000 ALTER TABLE `conversations` DISABLE KEYS */;
INSERT INTO `conversations` VALUES ('oDemoBuyer_oDemoSeller_ca6f738caf5a41c3ba17e283a34a64b0',NULL,'oDemoBuyer','oDemoSeller','ca6f738caf5a41c3ba17e283a34a64b0',NULL,'还在吗？',1792559476857,NULL,1792559476851,1792559476857);
/*!40000 ALTER TABLE `conversations` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `favorites`
--

DROP TABLE IF EXISTS `favorites`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `favorites` (
  `id` varchar(100) NOT NULL COMMENT 'openid_goodsId',
  `openid` varchar(64) NOT NULL COMMENT '用户 openid',
  `goods_id` varchar(64) NOT NULL COMMENT '商品 id',
  `created_at` bigint DEFAULT '0' COMMENT '收藏时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_user_goods` (`openid`,`goods_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='用户收藏表';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `favorites`
--

LOCK TABLES `favorites` WRITE;
/*!40000 ALTER TABLE `favorites` DISABLE KEYS */;
INSERT INTO `favorites` VALUES ('08bf5ea46c214cf3895fdb3c25f907e4','oDemoBuyer','ca6f738caf5a41c3ba17e283a34a64b0',1792559476650);
/*!40000 ALTER TABLE `favorites` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `feedback`
--

DROP TABLE IF EXISTS `feedback`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `feedback` (
  `id` varchar(64) NOT NULL COMMENT '云文档 _id',
  `openid` varchar(64) NOT NULL COMMENT '提交人 openid',
  `nick_name` varchar(50) DEFAULT '' COMMENT '昵称',
  `school` varchar(30) DEFAULT '' COMMENT '学校',
  `campus` varchar(30) DEFAULT '' COMMENT '所属学校（多校隔离）',
  `kind` varchar(10) DEFAULT 'other' COMMENT '类型：suggest/bug/report/other',
  `content` varchar(500) DEFAULT '' COMMENT '反馈内容',
  `contact` varchar(50) DEFAULT '' COMMENT '联系方式',
  `images` longtext COMMENT '图片 fileID 数组',
  `status` varchar(10) DEFAULT 'pending' COMMENT '状态：pending/resolved/rejected',
  `handler_note` varchar(200) DEFAULT '' COMMENT '处理备注',
  `handled_at` bigint DEFAULT NULL COMMENT '处理时间',
  `created_at` bigint DEFAULT '0' COMMENT '提交时间',
  PRIMARY KEY (`id`),
  KEY `idx_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='意见反馈/举报表';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `feedback`
--

LOCK TABLES `feedback` WRITE;
/*!40000 ALTER TABLE `feedback` DISABLE KEYS */;
/*!40000 ALTER TABLE `feedback` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `goods`
--

DROP TABLE IF EXISTS `goods`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `goods` (
  `id` varchar(64) NOT NULL COMMENT '云文档 _id',
  `openid` varchar(64) NOT NULL COMMENT '卖家 openid',
  `title` varchar(30) NOT NULL COMMENT '标题',
  `description` varchar(1000) DEFAULT '' COMMENT '描述',
  `images` longtext COMMENT '图片 fileID 数组',
  `cover` varchar(500) DEFAULT '' COMMENT '封面 fileID',
  `price` decimal(10,2) DEFAULT '0.00' COMMENT '价格',
  `original_price` decimal(10,2) DEFAULT NULL COMMENT '原价（可空）',
  `category` varchar(20) DEFAULT '' COMMENT '分类 key（book/digital/...）',
  `condition` varchar(10) DEFAULT 'normal' COMMENT '成色',
  `campus` varchar(30) DEFAULT '' COMMENT '所属学校（多校隔离）',
  `pickup_point` varchar(100) DEFAULT '' COMMENT '自提点',
  `type` varchar(10) DEFAULT 'sell' COMMENT '类型：sell/want',
  `status` varchar(10) DEFAULT 'pending' COMMENT '状态：pending/onSale/off/sold/reserved/banned',
  `reviewed_at` bigint DEFAULT '0' COMMENT '审核时间',
  `img_check_status` varchar(10) DEFAULT 'safe' COMMENT '图片审核：pending/safe/risky',
  `view_count` int DEFAULT '0' COMMENT '浏览量',
  `fav_count` int DEFAULT '0' COMMENT '收藏数',
  `want_count` int DEFAULT '0' COMMENT '想要数',
  `off_type` varchar(20) DEFAULT NULL COMMENT '下架来源：self/admin/report/ban/imgRisk/reviewReject',
  `off_reason` varchar(200) DEFAULT NULL COMMENT '下架原因',
  `off_at` bigint DEFAULT NULL COMMENT '下架时间',
  `off_by` varchar(64) DEFAULT NULL COMMENT '下架操作人 openid',
  `recheck` tinyint(1) DEFAULT '0' COMMENT '是否进入二次审核队列',
  `recheck_at` bigint DEFAULT NULL COMMENT '二次审核时间',
  `ban_reason` varchar(200) DEFAULT NULL COMMENT '封禁原因',
  `banned_at` bigint DEFAULT NULL COMMENT '封禁时间',
  `check_retries` int DEFAULT '0' COMMENT '图片检测重试次数',
  `created_at` bigint DEFAULT '0' COMMENT '创建时间',
  `updated_at` bigint DEFAULT '0' COMMENT '更新时间',
  PRIMARY KEY (`id`),
  KEY `idx_openid_status` (`openid`,`status`),
  KEY `idx_campus_status` (`campus`,`status`),
  KEY `idx_category` (`category`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='商品表';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `goods`
--

LOCK TABLES `goods` WRITE;
/*!40000 ALTER TABLE `goods` DISABLE KEYS */;
INSERT INTO `goods` VALUES ('ca6f738caf5a41c3ba17e283a34a64b0','oDemoSeller','九成新自行车','','[]','',199.00,NULL,'daily','normal','深圳大学','','sell','sold',0,'safe',0,1,0,NULL,NULL,NULL,NULL,0,NULL,NULL,NULL,0,1792559476560,1792559476799),('g_demo001','openid_demo_001','九成新《计算机网络》','自用教材，无笔记，便宜出',NULL,'https://picsum.photos/200',25.00,NULL,'book','normal','示例大学','','sell','onSale',0,'safe',12,3,0,NULL,NULL,NULL,NULL,0,NULL,NULL,NULL,0,1791471515000,1791471515000),('g_demo002','openid_demo_001','iPad 2021 64G','考研闲置，配件齐全',NULL,'https://picsum.photos/201',1800.00,NULL,'digital','normal','示例大学','','sell','onSale',0,'safe',30,8,0,NULL,NULL,NULL,NULL,0,NULL,NULL,NULL,0,1791471515000,1791471515000);
/*!40000 ALTER TABLE `goods` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `messages`
--

DROP TABLE IF EXISTS `messages`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `messages` (
  `id` varchar(64) NOT NULL COMMENT '云文档 _id',
  `openid` varchar(64) NOT NULL COMMENT '发送者 openid',
  `conv_id` varchar(100) DEFAULT '' COMMENT '所属会话 id',
  `type` varchar(10) DEFAULT 'text' COMMENT '消息类型：text/image',
  `content` text COMMENT '文本内容 或 图片 fileID',
  `read` tinyint(1) DEFAULT '0' COMMENT '是否已读',
  `created_at` bigint DEFAULT '0' COMMENT '发送时间',
  PRIMARY KEY (`id`),
  KEY `idx_conv` (`conv_id`,`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='私信消息表';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `messages`
--

LOCK TABLES `messages` WRITE;
/*!40000 ALTER TABLE `messages` DISABLE KEYS */;
INSERT INTO `messages` VALUES ('ce4e9d8708714b0c9c32e4d15300652c','oDemoBuyer','oDemoBuyer_oDemoSeller_ca6f738caf5a41c3ba17e283a34a64b0','text','还在吗？',0,1792559476857);
/*!40000 ALTER TABLE `messages` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `orders`
--

DROP TABLE IF EXISTS `orders`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `orders` (
  `id` varchar(64) NOT NULL COMMENT '云文档 _id',
  `order_no` varchar(50) DEFAULT '' COMMENT '订单编号',
  `goods_id` varchar(64) DEFAULT '' COMMENT '商品 id',
  `goods_snapshot` longtext COMMENT '商品快照：{title,cover,price,originalPrice,category,condition,desc,images}',
  `buyer_id` varchar(64) DEFAULT '' COMMENT '买家 openid',
  `seller_id` varchar(64) DEFAULT '' COMMENT '卖家 openid',
  `price` decimal(10,2) DEFAULT NULL COMMENT '成交价',
  `status` varchar(20) DEFAULT 'pending' COMMENT '状态：pending/meeting/completed/cancelled',
  `meeting_time` varchar(50) DEFAULT '' COMMENT '自提时间',
  `meeting_place` varchar(50) DEFAULT '' COMMENT '自提地点',
  `message` varchar(200) DEFAULT '' COMMENT '留言',
  `campus` varchar(30) DEFAULT '' COMMENT '所属学校',
  `cancel_reason` varchar(200) DEFAULT NULL COMMENT '取消原因',
  `cancelled_by` varchar(10) DEFAULT NULL COMMENT '取消方：buyer/seller',
  `auto_cancelled` tinyint(1) DEFAULT '0' COMMENT '是否超时自动取消',
  `seller_confirm_at` bigint DEFAULT NULL COMMENT '卖家确认时间',
  `completed_at` bigint DEFAULT NULL COMMENT '完成时间',
  `completed_by` varchar(64) DEFAULT NULL COMMENT '完成操作人 openid',
  `buyer_review` longtext COMMENT '买家评价：{score,tags[],content,createdAt}',
  `seller_review` longtext COMMENT '卖家评价：{score,tags[],content,createdAt}',
  `created_at` bigint DEFAULT '0' COMMENT '创建时间',
  `updated_at` bigint DEFAULT '0' COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_order_no` (`order_no`),
  KEY `idx_buyer` (`buyer_id`,`status`),
  KEY `idx_seller` (`seller_id`,`status`),
  KEY `idx_goods` (`goods_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='订单表';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `orders`
--

LOCK TABLES `orders` WRITE;
/*!40000 ALTER TABLE `orders` DISABLE KEYS */;
INSERT INTO `orders` VALUES ('412850a3a42e40478fd54ce867255a62','CM1792559476692661','ca6f738caf5a41c3ba17e283a34a64b0',NULL,'oDemoBuyer','oDemoSeller',199.00,'completed','今天18点','食堂','求购','深圳大学',NULL,NULL,0,1792559476759,1792559476795,'oDemoBuyer',NULL,NULL,1792559476692,1792559476795);
/*!40000 ALTER TABLE `orders` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `pickup_points`
--

DROP TABLE IF EXISTS `pickup_points`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `pickup_points` (
  `id` varchar(64) NOT NULL COMMENT '云文档 _id',
  `name` varchar(50) NOT NULL COMMENT '自提点名称',
  `description` varchar(200) DEFAULT '' COMMENT '描述',
  `campus` varchar(30) DEFAULT '' COMMENT '所属学校',
  `created_at` bigint DEFAULT '0' COMMENT '创建时间',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='自提点表';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `pickup_points`
--

LOCK TABLES `pickup_points` WRITE;
/*!40000 ALTER TABLE `pickup_points` DISABLE KEYS */;
/*!40000 ALTER TABLE `pickup_points` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `reports`
--

DROP TABLE IF EXISTS `reports`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `reports` (
  `id` varchar(64) NOT NULL COMMENT '云文档 _id',
  `openid` varchar(64) NOT NULL COMMENT '举报人 openid',
  `reporter_nick` varchar(50) DEFAULT '' COMMENT '举报人昵称',
  `target_type` varchar(10) DEFAULT '' COMMENT '举报对象类型：goods/user',
  `target_id` varchar(64) DEFAULT '' COMMENT '举报对象 id',
  `reason` varchar(50) DEFAULT '' COMMENT '举报原因',
  `description` varchar(500) DEFAULT '' COMMENT '举报描述',
  `images` longtext COMMENT '凭证图 fileID 数组',
  `status` varchar(10) DEFAULT 'pending' COMMENT '处理状态：pending',
  `created_at` bigint DEFAULT '0' COMMENT '创建时间',
  PRIMARY KEY (`id`),
  KEY `idx_target` (`target_type`,`target_id`),
  KEY `idx_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='举报表';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `reports`
--

LOCK TABLES `reports` WRITE;
/*!40000 ALTER TABLE `reports` DISABLE KEYS */;
/*!40000 ALTER TABLE `reports` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `reviews`
--

DROP TABLE IF EXISTS `reviews`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `reviews` (
  `id` varchar(64) NOT NULL COMMENT '云文档 _id',
  `openid` varchar(64) NOT NULL COMMENT '评价人 openid',
  `order_id` varchar(64) DEFAULT '' COMMENT '关联订单 id',
  `role` varchar(10) DEFAULT '' COMMENT '评价角色：buyer/seller',
  `score` int DEFAULT '5' COMMENT '评分 1~5',
  `created_at` bigint DEFAULT '0' COMMENT '评价时间',
  PRIMARY KEY (`id`),
  KEY `idx_order` (`order_id`),
  KEY `idx_openid` (`openid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='评价表';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `reviews`
--

LOCK TABLES `reviews` WRITE;
/*!40000 ALTER TABLE `reviews` DISABLE KEYS */;
/*!40000 ALTER TABLE `reviews` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `users`
--

DROP TABLE IF EXISTS `users`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `users` (
  `id` varchar(64) NOT NULL COMMENT '云文档 _id',
  `openid` varchar(64) NOT NULL COMMENT '微信 openid（唯一标识）',
  `nick_name` varchar(20) DEFAULT '' COMMENT '昵称',
  `avatar_url` varchar(500) DEFAULT '' COMMENT '头像（cloud:// 或 https）',
  `school` varchar(30) DEFAULT '' COMMENT '学校（多校隔离依据）',
  `student_id` varchar(20) DEFAULT '' COMMENT '学号',
  `real_name` varchar(30) DEFAULT '' COMMENT '真实姓名',
  `gender` varchar(4) DEFAULT '' COMMENT '性别：空/男/女',
  `education` varchar(8) DEFAULT '' COMMENT '学历：专科/本科/硕士/博士',
  `verified` tinyint(1) DEFAULT '0' COMMENT '是否校园认证',
  `credit` int DEFAULT '100' COMMENT '信用分 0~100',
  `is_admin` tinyint(1) DEFAULT '0' COMMENT '是否管理员',
  `status` varchar(10) DEFAULT 'active' COMMENT '账号状态：active/banned',
  `on_sale_count` int DEFAULT '0' COMMENT '在售商品数',
  `sold_count` int DEFAULT '0' COMMENT '售出数',
  `bought_count` int DEFAULT '0' COMMENT '买入数',
  `published_count` int DEFAULT '0' COMMENT '发布总数',
  `last_active_at` bigint DEFAULT '0' COMMENT '最近活跃（毫秒epoch）',
  `created_at` bigint DEFAULT '0' COMMENT '注册时间（毫秒epoch）',
  `updated_at` bigint DEFAULT '0' COMMENT '更新时间（毫秒epoch）',
  `verify_apply` longtext COMMENT '学生认证申请对象：{status,reason,realName,studentId,school,education,evidence[],createdAt,handledAt,agreed,agreedAt,...}',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_openid` (`openid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='用户表';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `users`
--

LOCK TABLES `users` WRITE;
/*!40000 ALTER TABLE `users` DISABLE KEYS */;
INSERT INTO `users` VALUES ('63e530a121c94ecc877d3645ff462299','oDemoBuyer','','','','','','','',0,100,0,'active',0,0,0,0,0,1792559476523,1792559476523,NULL),('u_demo001','openid_demo_001','校园小王','','示例大学','','','','',1,100,0,'active',0,0,0,0,0,1791471515000,1791471515000,NULL);
/*!40000 ALTER TABLE `users` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `view_logs`
--

DROP TABLE IF EXISTS `view_logs`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `view_logs` (
  `id` varchar(100) NOT NULL COMMENT 'openid_goodsId',
  `openid` varchar(64) NOT NULL COMMENT '用户 openid',
  `goods_id` varchar(64) NOT NULL COMMENT '商品 id',
  `created_at` bigint DEFAULT '0' COMMENT '首次浏览时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_user_goods` (`openid`,`goods_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='商品浏览记录表（去重浏览量）';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `view_logs`
--

LOCK TABLES `view_logs` WRITE;
/*!40000 ALTER TABLE `view_logs` DISABLE KEYS */;
/*!40000 ALTER TABLE `view_logs` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `wants`
--

DROP TABLE IF EXISTS `wants`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `wants` (
  `id` varchar(100) NOT NULL COMMENT 'openid_goodsId',
  `openid` varchar(64) NOT NULL COMMENT '用户 openid',
  `goods_id` varchar(64) NOT NULL COMMENT '商品 id',
  `created_at` bigint DEFAULT '0' COMMENT '想要时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_user_goods` (`openid`,`goods_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='用户想要表';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `wants`
--

LOCK TABLES `wants` WRITE;
/*!40000 ALTER TABLE `wants` DISABLE KEYS */;
/*!40000 ALTER TABLE `wants` ENABLE KEYS */;
UNLOCK TABLES;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2026-10-21 13:12:53
