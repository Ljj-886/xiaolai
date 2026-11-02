package com.campus.mall.controller;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 根路径欢迎页。
 *
 * 作用：解决直接访问 http://localhost:9090 时的 Whitelabel 404
 * （Spring Boot 默认没有给 "/" 配置映射，所以只有 /api/xxx 能访问）。
 * 仅用于开发/演示时快速查看服务状态与可用接口，不参与任何业务逻辑。
 */
@RestController
public class IndexController {

    @GetMapping(value = "/", produces = "text/html;charset=UTF-8")
    public String index() {
        return """
                <!DOCTYPE html>
                <html lang="zh-CN">
                <head>
                  <meta charset="UTF-8">
                  <meta name="viewport" content="width=device-width, initial-scale=1">
                  <title>校园集市 · mall-server</title>
                  <style>
                    body { margin: 0; padding: 40px 24px; font-family: -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
                           background: #FFF9EE; color: #3D2B1F; }
                    .wrap { max-width: 820px; margin: 0 auto; }
                    h1 { font-size: 24px; margin: 0 0 6px; }
                    .sub { color: #8A6F55; margin-bottom: 22px; }
                    .badge { display: inline-block; padding: 2px 10px; border-radius: 999px; font-size: 13px;
                             background: #E7F7F3; color: #1B9E8A; border: 1px solid #B7E6DC; margin-left: 8px; }
                    table { width: 100%; border-collapse: collapse; background: #fff;
                            border: 2px solid #3D2B1F; border-radius: 12px; overflow: hidden; }
                    th, td { text-align: left; padding: 10px 14px; border-bottom: 1px solid #E8DCC6; font-size: 14px; }
                    th { background: #FFE3D6; font-weight: 600; }
                    tr:last-child td { border-bottom: none; }
                    code { font-family: Consolas, monospace; background: #F5EADA; padding: 1px 6px; border-radius: 6px; }
                    .m { color: #E8542F; font-weight: 600; }
                    .foot { margin-top: 18px; color: #B39B80; font-size: 13px; }
                  </style>
                </head>
                <body>
                  <div class="wrap">
                    <h1>校园集市 · mall-server<span class="badge">running</span></h1>
                    <div class="sub">Spring Boot + MyBatis-Plus + MySQL &nbsp;|&nbsp; 库：campus_market @ 127.0.0.1:3306</div>
                    <table>
                      <tr><th style="width:90px">方法</th><th style="width:300px">路径</th><th>说明</th></tr>
                      <tr><td class="m">GET</td><td><code>/api/categories</code></td><td>分类列表</td></tr>
                      <tr><td class="m">GET</td><td><code>/api/goods/list</code></td><td>商品列表（campus / category / keyword / current / size）</td></tr>
                      <tr><td class="m">GET</td><td><code>/api/goods/{id}</code></td><td>商品详情</td></tr>
                      <tr><td class="m">POST</td><td><code>/api/goods/publish</code></td><td>发布商品（JSON body）</td></tr>
                      <tr><td class="m">POST</td><td><code>/api/goods/{id}/status</code></td><td>商品状态流转（status / offType / offReason）</td></tr>
                      <tr><td class="m">POST</td><td><code>/api/orders/create</code></td><td>创建订单（JSON body）</td></tr>
                      <tr><td class="m">POST</td><td><code>/api/orders/{id}/complete</code></td><td>完成订单（operator）</td></tr>
                      <tr><td class="m">GET</td><td><code>/api/user</code></td><td>用户信息（openid）</td></tr>
                      <tr><td class="m">POST</td><td><code>/api/user/upsert</code></td><td>用户新增/更新（JSON body）</td></tr>
                      <tr><td class="m">GET</td><td><code>/api/conversations</code></td><td>我的会话列表（openid）</td></tr>
                      <tr><td class="m">POST</td><td><code>/api/conversations/{convId}/messages</code></td><td>发消息（openid / content）</td></tr>
                      <tr><td class="m">GET</td><td><code>/api/messages</code></td><td>消息列表（convId）</td></tr>
                    </table>
                    <div class="foot">根路径 "/" 仅作导航；业务接口统一在 /api 下，返回 { code, msg, data } 信封。</div>
                  </div>
                </body>
                </html>
                """;
    }
}
