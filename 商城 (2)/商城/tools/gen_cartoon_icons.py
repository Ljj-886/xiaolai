# -*- coding: utf-8 -*-
"""生成「卡通贴纸」风格的自绘图标，替换原先的系统 emoji。

设计规范（与 tabBar 图标一致）：
  · 画布 120x120，透明底
  · 描边：深棕 #3D2B1F，宽度 8（粗描边是卡通感的关键）
  · 填充：扁平糖果色，不用渐变/阴影
  · 图形圆润，只保留必要结构线

输出到 images/，文件名见 ICONS 表。
"""
import math
import os
from PIL import Image, ImageDraw

S = 120
O = (61, 43, 31, 255)
W = 8
HERE = os.path.dirname(os.path.abspath(__file__))
IMG = os.path.join(HERE, '..', 'images')
os.makedirs(IMG, exist_ok=True)


def rr(d, box, r, fill, w=W):
    d.rounded_rectangle(box, radius=r, fill=fill, outline=O, width=w)


def el(d, box, fill, w=W):
    if fill is None:
        d.ellipse(box, outline=O, width=w)
    else:
        d.ellipse(box, fill=fill, outline=O, width=w)


def pg(d, pts, fill, w=W):
    d.polygon(pts, fill=fill)
    d.line(list(pts) + [pts[0]], fill=O, width=w, joint='curve')


def ln(d, pts, color=O, w=W):
    d.line(pts, fill=color, width=w, joint='curve')


def star_pts(cx, cy, R, r, n=5, rot=-90):
    pts = []
    for i in range(n * 2):
        ang = math.radians(rot + i * 180 / n)
        rad = R if i % 2 == 0 else r
        pts.append((cx + rad * math.cos(ang), cy + rad * math.sin(ang)))
    return pts


def heart_pts(cx, cy, k, n=48):
    pts = []
    for i in range(n):
        t = i * 2 * math.pi / n
        x = 16 * math.sin(t) ** 3
        y = 13 * math.cos(t) - 5 * math.cos(2 * t) - 2 * math.cos(3 * t) - math.cos(4 * t)
        pts.append((cx + x * k / 16, cy - y * k / 16))
    return pts


# ---------------- 分类图标 ----------------

def i_book(d):
    rr(d, (16, 24, 104, 58), 8, (127, 196, 232, 255))
    rr(d, (16, 56, 104, 96), 8, (155, 217, 123, 255))
    ln(d, [(34, 64), (34, 88)], color=(61, 43, 31, 255), w=6)
    ln(d, [(92, 32), (92, 50)], color=(61, 43, 31, 255), w=6)


def i_digital(d):
    rr(d, (18, 20, 102, 76), 10, (127, 196, 232, 255))
    rr(d, (30, 32, 90, 64), 6, (234, 246, 255, 255), w=6)
    rr(d, (10, 76, 110, 96), 8, (216, 210, 198, 255))


def i_dorm(d):
    rr(d, (14, 22, 34, 98), 8, (201, 154, 107, 255))
    rr(d, (34, 56, 106, 84), 10, (255, 199, 190, 255))
    rr(d, (40, 34, 70, 56), 8, (255, 255, 255, 255))
    rr(d, (24, 98, 106, 108), 5, (201, 154, 107, 255), w=6)


def i_clothes(d):
    pg(d, [(38, 30), (82, 30), (104, 48), (88, 66), (82, 60), (82, 100), (38, 100), (38, 60), (32, 66), (16, 48)],
       (155, 217, 123, 255))
    pg(d, [(46, 30), (60, 46), (74, 30)], (255, 255, 255, 255), w=6)


def i_sports(d):
    el(d, (12, 12, 108, 108), (245, 164, 91, 255))
    ln(d, [(12, 60), (108, 60)])
    d.arc((34, 12, 86, 108), 0, 360, fill=O, width=7)
    d.arc((12, 34, 108, 86), 200, 340, fill=O, width=6)


def i_beauty(d):
    rr(d, (40, 68, 80, 104), 7, (216, 210, 198, 255))
    rr(d, (36, 56, 84, 72), 6, (176, 168, 152, 255), w=6)
    rr(d, (43, 16, 77, 60), 13, (255, 122, 154, 255))


def i_bike(d):
    el(d, (12, 56, 58, 102), None)
    el(d, (62, 56, 108, 102), None)
    ln(d, [(35, 79), (60, 52), (85, 79), (35, 79)], w=7)
    ln(d, [(60, 52), (54, 40)], w=7)
    ln(d, [(85, 79), (92, 48)], w=7)
    ln(d, [(84, 48), (102, 48)], w=7)


def i_ticket(d):
    rr(d, (10, 36, 110, 84), 12, (255, 217, 138, 255))
    for y in range(42, 80, 12):
        ln(d, [(76, y), (76, y + 7)], w=5)
    d.arc((66, 26, 86, 46), 0, 360, fill=O, width=5)
    d.arc((66, 74, 86, 94), 0, 360, fill=O, width=5)


def i_life(d):
    rr(d, (38, 48, 82, 104), 14, (155, 217, 196, 255))
    rr(d, (52, 32, 68, 52), 4, (216, 210, 198, 255), w=6)
    rr(d, (48, 16, 86, 30), 7, (216, 210, 198, 255))
    rr(d, (46, 62, 74, 84), 7, (255, 255, 255, 255), w=6)


def i_other(d):
    rr(d, (22, 50, 98, 102), 10, (224, 176, 114, 255))
    rr(d, (14, 28, 106, 58), 8, (240, 198, 138, 255))
    rr(d, (54, 28, 66, 102), 2, (255, 255, 255, 255), w=6)


# ---------------- 我的页四宫格 ----------------

def i_order_pending(d):
    el(d, (12, 12, 108, 108), (255, 217, 138, 255))
    ln(d, [(44, 38), (60, 60), (76, 38)], w=8)
    ln(d, [(60, 60), (60, 84)], w=8)
    ln(d, [(44, 62), (76, 62)], w=7)
    ln(d, [(44, 76), (76, 76)], w=7)


def i_order_meeting(d):
    el(d, (28, 14, 92, 78), (255, 158, 181, 255))
    pg(d, [(60, 112), (40, 62), (80, 62)], (255, 158, 181, 255))
    el(d, (50, 36, 70, 56), (255, 255, 255, 255), w=6)


def i_order_completed(d):
    el(d, (12, 12, 108, 108), (155, 217, 123, 255))
    ln(d, [(36, 60), (54, 78), (86, 42)], color=(255, 255, 255, 255), w=12)
    ln(d, [(36, 60), (54, 78), (86, 42)], w=5)


def i_order_sold(d):
    pg(d, [(60, 12), (108, 60), (60, 108), (12, 60)], (127, 196, 232, 255))
    el(d, (74, 32, 90, 48), (255, 255, 255, 255), w=6)


# ---------------- 详情页操作栏 ----------------

def i_fav(d):
    pg(d, heart_pts(60, 62, 44), (255, 255, 255, 255))


def i_fav_on(d):
    pg(d, heart_pts(60, 62, 44), (240, 90, 110, 255))


def i_want(d):
    pg(d, star_pts(60, 62, 46, 19), (255, 255, 255, 255))


def i_want_on(d):
    pg(d, star_pts(60, 62, 46, 19), (255, 199, 61, 255))


def i_chat(d):
    rr(d, (10, 18, 110, 74), 18, (127, 196, 232, 255))
    pg(d, [(34, 70), (34, 104), (66, 70)], (127, 196, 232, 255))
    el(d, (34, 38, 46, 50), (61, 43, 31, 255), w=2)
    el(d, (54, 38, 66, 50), (61, 43, 31, 255), w=2)
    el(d, (74, 38, 86, 50), (61, 43, 31, 255), w=2)


def i_report(d):
    ln(d, [(32, 14), (32, 108)], w=9)
    pg(d, [(32, 20), (94, 34), (94, 66), (32, 54)], (240, 90, 110, 255))


def i_edit(d):
    pg(d, [(40, 78), (76, 22), (98, 38), (62, 94)], (255, 199, 61, 255))
    pg(d, [(40, 78), (62, 94), (30, 104)], (240, 198, 138, 255))
    ln(d, [(52, 50), (74, 66)], w=6)


def i_megaphone(d):
    pg(d, [(16, 48), (70, 24), (70, 76), (16, 60)], (255, 199, 61, 255))
    rr(d, (70, 34, 96, 66), 10, (216, 210, 198, 255))
    ln(d, [(30, 60), (40, 96)], w=9)


def i_cap(d):
    pg(d, [(60, 16), (112, 40), (60, 64), (8, 40)], (127, 196, 232, 255))
    rr(d, (34, 50, 86, 76), 8, (216, 210, 198, 255))
    ln(d, [(92, 44), (100, 76)], w=6)
    el(d, (94, 72, 110, 88), (255, 199, 61, 255), w=6)


def i_shield(d):
    pg(d, [(60, 12), (104, 30), (104, 62), (60, 108), (16, 62), (16, 30)], (155, 217, 196, 255))
    ln(d, [(42, 54), (55, 69), (80, 40)], color=(255, 255, 255, 255), w=11)
    ln(d, [(42, 54), (55, 69), (80, 40)], w=4)


def i_doc(d):
    pg(d, [(30, 12), (78, 12), (98, 36), (98, 108), (30, 108)], (255, 255, 255, 255))
    pg(d, [(78, 12), (98, 36), (78, 36)], (216, 210, 198, 255))
    for y in (56, 74, 92):
        ln(d, [(44, y), (84, y)], w=6)


def i_trash(d):
    el(d, (44, 18, 76, 34), (216, 210, 198, 255), w=6)
    rr(d, (14, 30, 106, 48), 8, (216, 210, 198, 255))
    pg(d, [(26, 50), (94, 50), (86, 110), (34, 110)], (127, 196, 232, 255))
    ln(d, [(50, 64), (50, 98)], w=5)
    ln(d, [(70, 64), (70, 98)], w=5)


def i_info(d):
    el(d, (12, 12, 108, 108), (127, 196, 232, 255))
    el(d, (54, 28, 66, 40), (61, 43, 31, 255), w=2)
    ln(d, [(60, 52), (60, 88)], color=(255, 255, 255, 255), w=11)
    ln(d, [(60, 52), (60, 88)], w=4)


def i_exit(d):
    rr(d, (16, 20, 66, 100), 10, (216, 210, 198, 255))
    rr(d, (42, 54, 60, 66), 4, (61, 43, 31, 255), w=3)
    ln(d, [(58, 60), (96, 60)], w=9)
    pg(d, [(84, 42), (110, 60), (84, 78)], (255, 199, 61, 255), w=7)


ICONS = {
    'cat_book': i_book, 'cat_digital': i_digital, 'cat_dorm': i_dorm,
    'cat_clothes': i_clothes, 'cat_sports': i_sports, 'cat_beauty': i_beauty,
    'cat_bike': i_bike, 'cat_ticket': i_ticket, 'cat_life': i_life, 'cat_other': i_other,
    'ico_order_pending': i_order_pending, 'ico_order_meeting': i_order_meeting,
    'ico_order_completed': i_order_completed, 'ico_order_sold': i_order_sold,
    'ico_fav': i_fav, 'ico_fav_on': i_fav_on, 'ico_want': i_want, 'ico_want_on': i_want_on,
    'ico_chat': i_chat, 'ico_report': i_report, 'ico_edit': i_edit,
    'ico_megaphone': i_megaphone, 'ico_cap': i_cap, 'ico_shield': i_shield,
    'ico_doc': i_doc, 'ico_trash': i_trash, 'ico_info': i_info, 'ico_exit': i_exit,
}


def main():
    made = []
    for name, fn in ICONS.items():
        img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
        fn(ImageDraw.Draw(img))
        img.save(os.path.join(IMG, name + '.png'))
        made.append(name + '.png')
    print('已生成 %d 个卡通图标到 images/：' % len(made))
    print('  ' + ', '.join(made))


if __name__ == '__main__':
    main()
