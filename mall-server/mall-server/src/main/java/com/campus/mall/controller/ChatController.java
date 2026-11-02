package com.campus.mall.controller;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.core.conditions.update.UpdateWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.campus.mall.common.PageResult;
import com.campus.mall.common.Param;
import com.campus.mall.common.R;
import com.campus.mall.common.TextUtil;
import com.campus.mall.entity.Conversation;
import com.campus.mall.entity.Message;
import com.campus.mall.mapper.ConversationMapper;
import com.campus.mall.mapper.MessageMapper;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.annotation.Resource;
import org.springframework.web.bind.annotation.*;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@RestController
public class ChatController {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    @Resource
    private ConversationMapper conversationMapper;

    @Resource
    private MessageMapper messageMapper;

    @PostMapping("/api/chat")
    public R<?> dispatch(@RequestBody Map<String, Object> req) {
        Param p = new Param(req);
        String action = p.s("action");
        if (action == null) return R.fail("缺少 action");
        switch (action) {
            // 会话列表必须做投影：participants 在库里是 JSON 文本，
            // 直接返回会让前端 conv.participants.find() 对字符串调用 → TypeError，点会话直接崩。
            case "convs": {
                String me = p.s("openid");
                int curr = p.i("page") == null ? 1 : Math.max(1, p.i("page"));
                int size = p.i("pageSize") == null ? 20 : Math.min(50, Math.max(1, p.i("pageSize")));
                // ⚠️⚠️ 返回必须是 {list,total,hasMore}，不能是裸数组：
                // 前端 chat.js 读的是 r.list，裸数组会让「消息」页永远显示「还没有消息」，
                // 但数据库里会话是存在的 —— 这种静默空列表极难排查。
                if (me == null || me.isEmpty()) return R.ok(PageResult.of(new ArrayList<>(), 0, curr, size));
                QueryWrapper<Conversation> qw = new QueryWrapper<>();
                qw.and(w -> w.eq("person_a", me).or().eq("person_b", me));
                qw.orderByDesc("last_message_at");
                Page<Conversation> pg = conversationMapper.selectPage(new Page<>(curr, size), qw);
                List<Map<String, Object>> rows = new ArrayList<>();
                for (Conversation c : pg.getRecords()) rows.add(project(c, me));
                return R.ok(PageResult.of(rows, pg.getTotal(), curr, size));
            }
            case "messages": {
                String convId = p.s("convId");
                if (convId == null || convId.isEmpty()) {
                    return R.ok(PageResult.of(new ArrayList<>(), 0, 1, 50));
                }
                // since 是增量拉取的游标（上一次最后一条的时间戳）；0/空 = 拉全量。
                // 前端轮询每 4s 调一次，支持 since 才不会每次全表重拉。
                Long since = p.l("since");
                QueryWrapper<Message> qw = new QueryWrapper<>();
                qw.eq("conv_id", convId);
                if (since != null && since > 0) qw.gt("created_at", since);
                qw.orderByAsc("created_at");
                qw.last("LIMIT 300"); // 上限保护：一次最多 300 条，超出置 truncated 让前端全量重载
                List<Message> msgs = messageMapper.selectList(qw);
                boolean truncated = msgs.size() >= 300;
                Map<String, Object> m = new HashMap<>();
                m.put("list", msgs);
                m.put("records", msgs);
                m.put("total", msgs.size());
                m.put("truncated", truncated);
                m.put("hasMore", false);
                return R.ok(m);
            }
            case "send": {
                String me = p.s("openid");
                // ⚠️ 前端传的是 peerOpenid（不是 peer）——原来只读 peer 取到 null，
                // convId 变成「自己_x_商品」、person_b 恒为 x，对方永远收不到消息。
                String peer = p.s("peer");
                if (peer == null || peer.isEmpty()) peer = p.s("peerOpenid");
                String goodsId = p.s("goodsId");
                String convId = p.s("convId");
                if (convId == null || convId.isEmpty()) {
                    convId = buildConvId(me, peer, goodsId);
                }
                long now = System.currentTimeMillis();
                Conversation conv = conversationMapper.selectById(convId);
                if (conv == null) {
                    conv = new Conversation();
                    conv.setId(convId);
                    conv.setPersonA(me);
                    conv.setPersonB(peer == null ? "" : peer);
                    conv.setGoodsId(goodsId);
                    conv.setParticipants(jsonArray(me, peer)); // 前端据此识别对方
                    conv.setUnread("{}");
                    conv.setCreatedAt(now);
                    conv.setUpdatedAt(now);
                    conversationMapper.insert(conv);
                } else if (conv.getParticipants() == null || conv.getParticipants().isEmpty()) {
                    // 老会话缺 participants → 补齐，否则列表页算不出对方是谁
                    conv.setParticipants(jsonArray(conv.getPersonA(), conv.getPersonB()));
                }
                bumpUnread(conv, peer); // 对方未读 +1（tabBar 角标依赖它）

                Message msg = new Message();
                msg.setId(UUID.randomUUID().toString().replace("-", ""));
                msg.setOpenid(me);
                msg.setConvId(convId);
                msg.setType(p.s("type") == null ? "text" : p.s("type"));
                // 教室 MySQL 5.0.45 存不了 emoji（4 字节），不清洗会让整个 send 接口 500。
                // ⚠️ messages.content 和 conversations.last_message 都要清洗：
                // 只洗 content 会让消息写进去了、会话更新却报 1366，接口照样 500。
                String content = TextUtil.stripNonBmp(p.s("content"));
                msg.setContent(content);
                msg.setRead(0);
                msg.setCreatedAt(now);
                messageMapper.insert(msg);

                conv.setLastMessage(content);
                conv.setLastMessageAt(now);
                conv.setUpdatedAt(now);
                conversationMapper.updateById(conv);

                // 回带 convId：从商品页/订单页进来时前端手里没有 convId，
                // 不返回它就永远不知道自己属于哪个会话。
                Map<String, Object> res = new HashMap<>();
                res.put("id", msg.getId());
                res.put("_id", msg.getId());
                res.put("convId", convId);
                res.put("peerOpenid", peer);
                res.put("goodsId", goodsId);
                res.put("content", msg.getContent());
                res.put("type", msg.getType());
                res.put("createdAt", now);
                res.put("sentAt", now);
                res.put("_openid", me);
                return R.ok(res);
            }
            case "deleteConversation": {
                String convId = p.s("convId");
                conversationMapper.deleteById(convId);
                messageMapper.delete(new QueryWrapper<Message>().eq("conv_id", convId));
                return R.ok(true);
            }
            case "deleteMessage": {
                messageMapper.deleteById(p.s("msgId"));
                return R.ok(true);
            }
            default:
                return R.fail("未知 action: " + action);
        }
    }

    /**
     * 会话 ID = 排序后的双方 openid + 商品 id。
     * ⚠️ 必须排序：原来按「自己_对方」拼，买家发起和卖家发起会得到两个不同的 convId，
     * 双方各聊各的、永远对不上——这是「买了东西却聊不起来」的根因之一。
     */
    private String buildConvId(String a, String b, String goodsId) {
        String x = a == null ? "" : a;
        String y = b == null ? "" : b;
        String first = x.compareTo(y) <= 0 ? x : y;
        String second = x.compareTo(y) <= 0 ? y : x;
        return first + "_" + second + "_" + (goodsId == null ? "x" : goodsId);
    }

    /** participants 存 JSON 文本；前端要的是数组，这里统一序列化 */
    private String jsonArray(String a, String b) {
        try {
            return MAPPER.writeValueAsString(Arrays.asList(a == null ? "" : a, b == null ? "" : b));
        } catch (Exception e) {
            return "[]";
        }
    }

    /** 给某人累加未读（unread 存 {openid:count} 的 JSON 文本） */
    private void bumpUnread(Conversation conv, String who) {
        if (who == null || who.isEmpty()) return;
        Map<String, Object> m = new HashMap<>();
        try {
            if (conv.getUnread() != null && !conv.getUnread().isEmpty()) {
                Map<?, ?> parsed = MAPPER.readValue(conv.getUnread(), Map.class);
                // Map<?,?> 不能直接 putAll 到 Map<String,Object>（泛型不匹配），逐项拷贝
                if (parsed != null) {
                    for (Map.Entry<?, ?> en : parsed.entrySet()) {
                        m.put(String.valueOf(en.getKey()), en.getValue());
                    }
                }
            }
        } catch (Exception ignored) {}
        int cur = 0;
        Object v = m.get(who);
        if (v instanceof Number) cur = ((Number) v).intValue();
        m.put(who, cur + 1);
        try {
            conv.setUnread(MAPPER.writeValueAsString(m));
        } catch (Exception e) {
            conv.setUnread("{}");
        }
    }

    /** 会话投影：participants 还原成数组 + 算出当前用户未读数与对方 openid */
    private Map<String, Object> project(Conversation c, String me) {
        Map<String, Object> row = new HashMap<>();
        row.put("id", c.getId());
        row.put("_id", c.getId()); // 前端统一读 _id
        List<String> parts = new ArrayList<>();
        try {
            if (c.getParticipants() != null && !c.getParticipants().isEmpty()) {
                Object parsed = MAPPER.readValue(c.getParticipants(), List.class);
                if (parsed instanceof List) {
                    for (Object it : (List<?>) parsed) parts.add(String.valueOf(it));
                }
            }
        } catch (Exception ignored) {}
        if (parts.isEmpty()) {
            if (c.getPersonA() != null) parts.add(c.getPersonA());
            if (c.getPersonB() != null) parts.add(c.getPersonB());
        }
        row.put("participants", parts);
        row.put("personA", c.getPersonA());
        row.put("personB", c.getPersonB());
        row.put("goodsId", c.getGoodsId());
        row.put("lastMessage", c.getLastMessage());
        row.put("lastMessageAt", c.getLastMessageAt());
        row.put("updatedAt", c.getUpdatedAt());
        row.put("createdAt", c.getCreatedAt());
        String peer = me != null && me.equals(c.getPersonA()) ? c.getPersonB() : c.getPersonA();
        row.put("peerOpenid", peer);
        int unread = 0;
        try {
            if (c.getUnread() != null && !c.getUnread().isEmpty()) {
                Map<?, ?> m = MAPPER.readValue(c.getUnread(), Map.class);
                Object v = m != null ? m.get(me) : null;
                if (v instanceof Number) unread = ((Number) v).intValue();
            }
        } catch (Exception ignored) {}
        row.put("unreadCount", unread);
        return row;
    }
}
