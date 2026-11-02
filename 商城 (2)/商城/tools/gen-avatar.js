// 生成默认头像 PNG（人形剪影）：仅用 Node 内置 zlib，无需第三方依赖
const fs = require('fs');
const zlib = require('zlib');

const W = 160, H = 160;
const BG = [240, 240, 240];   // #F0F0F0
const FG = [200, 200, 200];   // #C8C8C8 剪影

// 人形：头（圆心 80,62 半径 30）+ 肩膀（半椭圆 圆心 80,168 半径 58/62，取 y>=104 部分）
function inside(x, y) {
  const dh = Math.hypot(x - 80, y - 62);
  if (dh <= 30) return true;
  if (y >= 104) {
    const dx = (x - 80) / 58, dy = (y - 168) / 62;
    if (dx * dx + dy * dy <= 1) return true;
  }
  return false;
}

const raw = Buffer.alloc(H * (1 + W * 4));
for (let y = 0; y < H; y++) {
  const row = y * (1 + W * 4);
  raw[row] = 0; // filter: none
  for (let x = 0; x < W; x++) {
    const c = inside(x + 0.5, y + 0.5) ? FG : BG;
    const o = row + 1 + x * 4;
    raw[o] = c[0]; raw[o + 1] = c[1]; raw[o + 2] = c[2]; raw[o + 3] = 255;
  }
}

const crcTable = [];
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  crcTable[n] = c >>> 0;
}
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8;  // bit depth
ihdr[9] = 6;  // RGBA
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0))
]);
fs.writeFileSync('D:/商城/images/avatar-default.png', png);
console.log('written', png.length, 'bytes');
