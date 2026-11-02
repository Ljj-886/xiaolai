// 生成 goods-cover-default.png：经典「图片占位」图标（圆角框 + 太阳 + 山），浅灰底
const fs = require('fs');
const zlib = require('zlib');
const W = 200, H = 200;
const BG = [242, 242, 242];   // #F2F2F2 背景
const FG = [208, 208, 208];   // #D0D0D0 框/图形
const FG2 = [224, 224, 224];  // 稍浅

function inside(x, y) {
  // 圆角矩形框（内框，描边用）：外框 (24,40)→(176,160) 圆角 16
  // 我们画整块填充区域 + 挖洞做描边。简化：画一个略小的填充圆角矩形当"画布"，外再一圈描边。
  // 直接用形状函数：
  return 0; // 占位，下面分类绘制
}

// 绘制到 raw 的像素数组
function setPx(buf, x, y, c) {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const o = y * (1 + W * 4) + 1 + x * 4;
  buf[o] = c[0]; buf[o + 1] = c[1]; buf[o + 2] = c[2]; buf[o + 3] = 255;
}
function fillRoundRect(buf, x0, y0, x1, y1, r, c) {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    // 圆角判定：四角 16x16 内用圆
    let dx = 0, dy = 0;
    if (x < x0 + r && y < y0 + r) { dx = (x0 + r) - x; dy = (y0 + r) - y; }
    else if (x >= x1 - r && y < y0 + r) { dx = x - (x1 - r - 1); dy = (y0 + r) - y; }
    else if (x < x0 + r && y >= y1 - r) { dx = (x0 + r) - x; dy = y - (y1 - r - 1); }
    else if (x >= x1 - r && y >= y1 - r) { dx = x - (x1 - r - 1); dy = y - (y1 - r - 1); }
    if (dx || dy) { if (dx * dx + dy * dy > r * r) continue; }
    setPx(buf, x, y, c);
  }
}
// 在 (cx,cy) 半径 r 画圆
function fillCircle(buf, cx, cy, r, c) {
  for (let y = cy - r - 1; y <= cy + r + 1; y++) for (let x = cx - r - 1; x <= cx + r + 1; x++) {
    const d2 = (x - cx) * (x - cx) + (y - cy) * (y - cy);
    if (d2 <= r * r) setPx(buf, x, y, c);
  }
}
// 三角形（顶点 p1,p2,p3）填充
function fillTriangle(buf, p1, p2, p3, c) {
  const minx = Math.max(0, Math.floor(Math.min(p1[0], p2[0], p3[0])));
  const maxx = Math.min(W - 1, Math.ceil(Math.max(p1[0], p2[0], p3[0])));
  const miny = Math.max(0, Math.floor(Math.min(p1[1], p2[1], p3[1])));
  const maxy = Math.min(H - 1, Math.ceil(Math.max(p1[1], p2[1], p3[1])));
  function edge(a, b, p) { return (p[0] - a[0]) * (b[1] - a[1]) - (b[0] - a[0]) * (p[1] - a[1]); }
  for (let y = miny; y <= maxy; y++) for (let x = minx; x <= maxx; x++) {
    const p = [x + 0.5, y + 0.5];
    const w1 = edge(p2, p3, p), w2 = edge(p3, p1, p), w3 = edge(p1, p2, p);
    const hasNeg = w1 < 0 || w2 < 0 || w3 < 0;
    const hasPos = w1 > 0 || w2 > 0 || w3 > 0;
    if (!(hasNeg && hasPos)) setPx(buf, x, y, c);
  }
}

const raw = Buffer.alloc(H * (1 + W * 4));
// 背景
for (let y = 0; y < H; y++) { raw[y * (1 + W * 4)] = 0; for (let x = 0; x < W; x++) setPx(raw, x, y, BG); }

// 圆角矩形外框（描边）：画两个圆角矩形，外大内小，相减即描边
const bx0 = 30, by0 = 50, bx1 = 170, by1 = 150, br = 14, rIn = br;
const strokeBuf = Buffer.alloc(W * H);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  // 在大圆角矩形内？
  let inBig = (x >= bx0 && x < bx1 && y >= by0 && y < by1);
  if (inBig) {
    // 四角圆角
    if (x < bx0 + br && y < by0 + br) { const dx = (bx0 + br) - x, dy = (by0 + br) - y; if (dx * dx + dy * dy > br * br) inBig = false; }
    else if (x >= bx1 - br && y < by0 + br) { const dx = x - (bx1 - br - 1), dy = (by0 + br) - y; if (dx * dx + dy * dy > br * br) inBig = false; }
    else if (x < bx0 + br && y >= by1 - br) { const dx = (bx0 + br) - x, dy = y - (by1 - br - 1); if (dx * dx + dy * dy > br * br) inBig = false; }
    else if (x >= bx1 - br && y >= by1 - br) { const dx = x - (bx1 - br - 1), dy = y - (by1 - br - 1); if (dx * dx + dy * dy > br * br) inBig = false; }
  }
  // 在小圆角矩形（内缩 4px）内？
  const inset = 5;
  let inSmall = (x >= bx0 + inset && x < bx1 - inset && y >= by0 + inset && y < by1 - inset);
  if (inSmall) {
    const ix0 = bx0 + inset, iy0 = by0 + inset, ix1 = bx1 - inset, iy1 = by1 - inset, ir = Math.max(0, br - inset);
    if (x < ix0 + ir && y < iy0 + ir) { const dx = (ix0 + ir) - x, dy = (iy0 + ir) - y; if (dx * dx + dy * dy > ir * ir) inSmall = false; }
    else if (x >= ix1 - ir && y < iy0 + ir) { const dx = x - (ix1 - ir - 1), dy = (iy0 + ir) - y; if (dx * dx + dy * dy > ir * ir) inSmall = false; }
    else if (x < ix0 + ir && y >= iy1 - ir) { const dx = (ix0 + ir) - x, dy = y - (iy1 - ir - 1); if (dx * dx + dy * dy > ir * ir) inSmall = false; }
    else if (x >= ix1 - ir && y >= iy1 - ir) { const dx = x - (ix1 - ir - 1), dy = y - (iy1 - ir - 1); if (dx * dx + dy * dy > ir * ir) inSmall = false; }
  }
  if (inBig && !inSmall) setPx(raw, x, y, FG); // 描边
}

// 太阳（左上小圆）
fillCircle(raw, 56, 78, 8, FG);
// 山（底部三角形）
fillTriangle(raw, [50, 138], [120, 78], [168, 138], FG);

const crcTable = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcTable[n] = c >>> 0; }
function crc32(buf) { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8; ihdr[9] = 6;
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0))
]);
fs.writeFileSync('D:/商城/images/goods-cover-default.png', png);
console.log('written', png.length, 'bytes → images/goods-cover-default.png');