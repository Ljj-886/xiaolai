# -*- coding: utf-8 -*-
"""纯 Python 生成小程序 tabBar 图标（无第三方依赖，4x 超采样抗锯齿）"""
import os, zlib, struct, math

SIZE = 81
SS = 4  # supersample

_OUT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(_OUT_DIR, 'images')
os.makedirs(OUT, exist_ok=True)


class Mask:
    def __init__(self, w, h):
        self.w, self.h = w, h
        self.px = [[0.0] * w for _ in range(h)]

    def add(self, other):
        for y in range(self.h):
            a, b = self.px[y], other.px[y]
            for x in range(self.w):
                if b[x]:
                    a[x] = 1.0

    def sub(self, other):
        for y in range(self.h):
            a, b = self.px[y], other.px[y]
            for x in range(self.w):
                if b[x]:
                    a[x] = 0.0


def blank(w, h):
    return Mask(w, h)


def fill_rect(m, x0, y0, x1, y1):
    for y in range(m.h):
        for x in range(m.w):
            if x0 <= x <= x1 and y0 <= y <= y1:
                m.px[y][x] = 1.0


def round_rect(m, x0, y0, x1, y1, r):
    for y in range(m.h):
        for x in range(m.w):
            if x < x0 or x > x1 or y < y0 or y > y1:
                continue
            cx = min(max(x, x0 + r), x1 - r)
            cy = min(max(y, y0 + r), y1 - r)
            if (x - cx) ** 2 + (y - cy) ** 2 <= r * r:
                m.px[y][x] = 1.0


def fill_circle(m, cx, cy, r):
    for y in range(m.h):
        for x in range(m.w):
            if (x - cx) ** 2 + (y - cy) ** 2 <= r * r:
                m.px[y][x] = 1.0


def fill_ring(m, cx, cy, r_out, r_in):
    for y in range(m.h):
        for x in range(m.w):
            d2 = (x - cx) ** 2 + (y - cy) ** 2
            if r_in * r_in <= d2 <= r_out * r_out:
                m.px[y][x] = 1.0


def arc_band(m, cx, cy, r_out, r_in, y_max):
    """半环（人像肩膀）"""
    for y in range(m.h):
        if y > y_max:
            continue
        for x in range(m.w):
            d2 = (x - cx) ** 2 + (y - cy) ** 2
            if r_in * r_in <= d2 <= r_out * r_out:
                m.px[y][x] = 1.0


def fill_tri(m, p0, p1, p2):
    (x0, y0), (x1, y1), (x2, y2) = p0, p1, p2
    minx, maxx = int(min(x0, x1, x2)), int(math.ceil(max(x0, x1, x2)))
    miny, maxy = int(min(y0, y1, y2)), int(math.ceil(max(y0, y1, y2)))

    def sign(a, b, c):
        return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])

    for y in range(max(0, miny), min(m.h, maxy + 1)):
        for x in range(max(0, minx), min(m.w, maxx + 1)):
            p = (x + 0.5, y + 0.5)
            d1 = sign((x0, y0), (x1, y1), p)
            d2 = sign((x1, y1), (x2, y2), p)
            d3 = sign((x2, y2), (x0, y0), p)
            neg = (d1 < 0) or (d2 < 0) or (d3 < 0)
            pos = (d1 > 0) or (d2 > 0) or (d3 > 0)
            if not (neg and pos):
                m.px[y][x] = 1.0


def build(fn):
    """fn 接收的坐标是 0..SIZE 的逻辑坐标，内部放大 SS 倍绘制"""
    W = H = SIZE * SS
    m = blank(W, H)
    fn(m, lambda v: v * SS)
    return m


def downsample(m):
    """4x 超采样 -> SIZE x SIZE 的 alpha 覆盖度"""
    out = []
    for y in range(SIZE):
        row = []
        for x in range(SIZE):
            acc = 0.0
            for dy in range(SS):
                src = m.px[y * SS + dy]
                for dx in range(SS):
                    acc += src[x * SS + dx]
            row.append(acc / (SS * SS))
        out.append(row)
    return out


def write_png(path, alpha, rgb):
    w = h = SIZE
    raw = bytearray()
    for y in range(h):
        raw.append(0)  # filter type 0
        for x in range(w):
            a = alpha[y][x]
            raw.append(rgb[0]); raw.append(rgb[1]); raw.append(rgb[2])
            raw.append(int(round(a * 255)))

    def chunk(tag, data):
        c = struct.pack('>I', len(data)) + tag + data
        return c + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff)

    ihdr = struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0)
    png = (b'\x89PNG\r\n\x1a\n'
           + chunk(b'IHDR', ihdr)
           + chunk(b'IDAT', zlib.compress(bytes(raw), 9))
           + chunk(b'IEND', b''))
    with open(path, 'wb') as f:
        f.write(png)
    return path


# ---------- 图标形状定义 ----------

def icon_home(m, s):
    fill_tri(m, (s(40), s(13)), (s(8), s(41)), (s(72), s(41)))
    fill_rect(m, s(17), s(39), s(63), s(68))
    door = blank(m.w, m.h)
    round_rect(door, s(33), s(51), s(47), s(68), s(1))
    m.sub(door)


def icon_category(m, s):
    for (x0, y0) in ((13, 13), (45, 13), (13, 45), (45, 45)):
        round_rect(m, s(x0), s(y0), s(x0 + 23), s(y0 + 23), s(5))


def icon_publish(m, s):
    fill_ring(m, s(40), s(40), s(30), s(24))
    fill_rect(m, s(36), s(25), s(44), s(55))
    fill_rect(m, s(25), s(36), s(55), s(44))


def icon_chat(m, s):
    round_rect(m, s(9), s(15), s(71), s(53), s(11))
    fill_tri(m, (s(24), s(50)), (s(24), s(69)), (s(42), s(53)))
    dots = blank(m.w, m.h)
    fill_circle(dots, s(27), s(34), s(4))
    fill_circle(dots, s(40), s(34), s(4))
    fill_circle(dots, s(53), s(34), s(4))
    m.sub(dots)


def icon_mine(m, s):
    fill_circle(m, s(40), s(27), s(12))
    arc_band(m, s(40), s(70), s(27), s(17), s(70))


def icon_order(m, s):
    round_rect(m, s(13), s(10), s(68), s(71), s(6))
    inner = blank(m.w, m.h)
    fill_rect(inner, s(19), s(16), s(62), s(65))
    m.sub(inner)
    fill_rect(m, s(25), s(28), s(56), s(31))
    fill_rect(m, s(25), s(39), s(56), s(42))
    fill_rect(m, s(25), s(50), s(44), s(53))


ICONS = {
    'home': icon_home,
    'category': icon_category,
    'publish': icon_publish,
    'chat': icon_chat,
    'order': icon_order,
    'mine': icon_mine,
}

NORMAL = (0x9A, 0x9A, 0x9A)
ACTIVE = (0xFF, 0x6B, 0x35)

if __name__ == '__main__':
    made = []
    for name, fn in ICONS.items():
        m = build(fn)
        alpha = downsample(m)
        made.append(write_png(os.path.join(OUT, 'tab_%s.png' % name), alpha, NORMAL))
        made.append(write_png(os.path.join(OUT, 'tab_%s_on.png' % name), alpha, ACTIVE))
    for p in made:
        print(os.path.basename(p), os.path.getsize(p))
