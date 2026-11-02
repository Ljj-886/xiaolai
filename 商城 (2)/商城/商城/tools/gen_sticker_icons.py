# -*- coding: utf-8 -*-
"""生成手绘贴纸风的 tabBar 图标（81x81 RGBA）

风格：深棕描边 + 扁平填充，描边略粗，图形圆润。
- 未选中：暖灰描边(#B39B80) + 浅暖填充(#F0E4D0)
- 选中：  深棕描边(#3D2B1F) + 珊瑚橙填充(#E8542F)

原图标先备份到临时目录，方便回退。
"""
import os
import shutil
import tempfile
from PIL import Image, ImageDraw

S = 81
INK = (61, 43, 31, 255)
CORAL = (232, 84, 47, 255)
PALE = (240, 228, 208, 255)
MUTE = (138, 111, 85, 255)   # 未选中：用更深的暖棕描边，小尺寸下更清晰
W = 7  # 描边宽度（tabBar 图标渲染尺寸小，稍粗更清晰）

HERE = os.path.dirname(os.path.abspath(__file__))
IMG = os.path.join(HERE, '..', 'images')
BACKUP = os.path.join(tempfile.gettempdir(), 'tabbar_backup')
os.makedirs(BACKUP, exist_ok=True)


def new_canvas():
    return Image.new('RGBA', (S, S), (0, 0, 0, 0))


def outline_poly(d, pts, fill, line, w=W):
    """多边形：先填色，再沿边描线（Pillow 的 polygon 不支持 width）"""
    d.polygon(pts, fill=fill)
    d.line(list(pts) + [pts[0]], fill=line, width=w, joint='curve')


def icon_home(d, f, o):
    d.rounded_rectangle((22, 38, 59, 68), radius=6, fill=f, outline=o, width=W)
    outline_poly(d, [(40, 12), (9, 42), (71, 42)], f, o)
    d.rounded_rectangle((35, 50, 46, 68), radius=3, fill=o)


def icon_category(d, f, o):
    for box in [(13, 13, 36, 36), (45, 13, 68, 36), (13, 45, 36, 68), (45, 45, 68, 68)]:
        d.rounded_rectangle(box, radius=7, fill=f, outline=o, width=5)


def icon_publish(d, f, o):
    d.ellipse((10, 10, 71, 71), fill=f, outline=o, width=W)
    d.line([(26, 40), (55, 40)], fill=o, width=9)
    d.line([(40, 26), (40, 55)], fill=o, width=9)


def icon_chat(d, f, o):
    d.rounded_rectangle((11, 15, 70, 55), radius=15, fill=f, outline=o, width=W)
    outline_poly(d, [(26, 52), (26, 70), (44, 52)], f, o)


def icon_mine(d, f, o):
    d.ellipse((29, 11, 52, 35), fill=f, outline=o, width=W)
    d.rounded_rectangle((17, 43, 64, 72), radius=19, fill=f, outline=o, width=W)


ICONS = {
    'home': icon_home,
    'category': icon_category,
    'publish': icon_publish,
    'chat': icon_chat,
    'mine': icon_mine,
}


def build(name, drawer, on):
    img = new_canvas()
    d = ImageDraw.Draw(img)
    drawer(d, CORAL if on else PALE, INK if on else MUTE)
    return img


def main():
    made = []
    for name, drawer in ICONS.items():
        for on in (False, True):
            fn = 'tab_%s%s.png' % (name, '_on' if on else '')
            src = os.path.join(IMG, fn)
            dst = os.path.join(BACKUP, fn)
            # 只在备份不存在时备份 —— 否则重复运行会把「上一次生成的图」覆盖成备份，
            # 真正的原始图标就被冲掉了（这个坑踩过一次）。
            if os.path.exists(src) and not os.path.exists(dst):
                shutil.copy2(src, dst)
            img = build(name, drawer, on)
            img.save(src)
            made.append(fn)
    print('已生成 %d 个图标：' % len(made))
    print('  ' + ', '.join(made))
    print('原始图标备份目录（仅首次生成时写入）：%s' % BACKUP)


if __name__ == '__main__':
    main()
