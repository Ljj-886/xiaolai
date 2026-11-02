-- 校园集市后端 · 示例数据（灌入 campus_market）
-- 执行（注意必须带 --default-character-set=utf8mb4，否则中文会乱码）：
--   mysql -h 127.0.0.1 -P 3306 -u root -p123456 --default-character-set=utf8mb4 campus_market < seed.sql

-- 1. 分类（对应小程序 utils/categories.js 的常用分类）
INSERT IGNORE INTO `categories` (`id`, `key`, `name`, `icon`, `sort`) VALUES
  ('cat_book',    'book',    '图书',  '📚', 1),
  ('cat_digital', 'digital', '数码',  '💻', 2),
  ('cat_daily',   'daily',   '日用',  '🧴', 3),
  ('cat_sports',  'sports',  '运动',  '⚽', 4),
  ('cat_ticket',  'ticket',  '票券',  '🎫', 5),
  ('cat_parttime','parttime','兼职',  '💼', 6),
  ('cat_lost',    'lost',    '失物',  '🔍', 7),
  ('cat_other',   'other',   '其他',  '📦', 99);

-- 2. 一个示例用户
INSERT IGNORE INTO `users` (`id`, `openid`, `nick_name`, `school`, `verified`, `credit`, `status`, `created_at`, `updated_at`)
  VALUES ('u_demo001', 'openid_demo_001', '校园小王', '示例大学', 1, 100, 'active', UNIX_TIMESTAMP()*1000, UNIX_TIMESTAMP()*1000);

-- 3. 两条示例在售商品
INSERT IGNORE INTO `goods` (`id`, `openid`, `title`, `description`, `cover`, `price`, `category`, `campus`, `type`, `status`, `view_count`, `fav_count`, `created_at`, `updated_at`)
  VALUES
  ('g_demo001', 'openid_demo_001', '九成新《计算机网络》', '自用教材，无笔记，便宜出', 'https://picsum.photos/200', 25.00, 'book', '示例大学', 'sell', 'onSale', 12, 3, UNIX_TIMESTAMP()*1000, UNIX_TIMESTAMP()*1000),
  ('g_demo002', 'openid_demo_001', 'iPad 2021 64G', '考研闲置，配件齐全', 'https://picsum.photos/201', 1800.00, 'digital', '示例大学', 'sell', 'onSale', 30, 8, UNIX_TIMESTAMP()*1000, UNIX_TIMESTAMP()*1000);
