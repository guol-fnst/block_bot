/**
 * create_icons.js
 * Generates icons/icon16.png, icons/icon48.png, icons/icon128.png
 * using only Node.js built-ins (no npm dependencies needed).
 *
 * Usage: node create_icons.js
 */
'use strict';

const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

function buildCrcTable() {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c;
  }
  return table;
}

const CRC_TABLE = buildCrcTable();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function u32be(n) {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n >>> 0, 0);
  return b;
}

function pngChunk(type, data) {
  const t = Buffer.from(type, 'ascii');
  const d = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const crc = u32be(crc32(Buffer.concat([t, d])));
  return Buffer.concat([u32be(d.length), t, d, crc]);
}

function clamp01(v) {
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

function mix(a, b, t) {
  return a + (b - a) * t;
}

function smoothstep(edge0, edge1, x) {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function alphaFromSdf(sdf, aa) {
  return 1 - smoothstep(0, aa, sdf);
}

function blend(dst, src, alpha) {
  const a = clamp01(alpha);
  dst.r = dst.r * (1 - a) + src.r * a;
  dst.g = dst.g * (1 - a) + src.g * a;
  dst.b = dst.b * (1 - a) + src.b * a;
}

function sdfCircle(x, y, cx, cy, r) {
  const dx = x - cx;
  const dy = y - cy;
  return Math.sqrt(dx * dx + dy * dy) - r;
}

function sdfRoundRect(x, y, cx, cy, hx, hy, radius) {
  const qx = Math.abs(x - cx) - hx + radius;
  const qy = Math.abs(y - cy) - hy + radius;
  const ox = Math.max(qx, 0);
  const oy = Math.max(qy, 0);
  return Math.sqrt(ox * ox + oy * oy) + Math.min(Math.max(qx, qy), 0) - radius;
}

function sdfSegment(x, y, ax, ay, bx, by, halfWidth) {
  const pax = x - ax;
  const pay = y - ay;
  const bax = bx - ax;
  const bay = by - ay;
  const h = clamp01((pax * bax + pay * bay) / (bax * bax + bay * bay));
  const dx = pax - bax * h;
  const dy = pay - bay * h;
  return Math.sqrt(dx * dx + dy * dy) - halfWidth;
}

function sampleLogo(nx, ny, aa) {
  const cx = 0.5;
  const cy = 0.5;
  const x = nx;
  const y = ny;

  const bgTop = { r: 13, g: 38, b: 89 };
  const bgBottom = { r: 15, g: 130, b: 170 };
  const grad = clamp01(y * 0.85 + x * 0.15);
  const vignette = clamp01(1 - Math.sqrt((x - cx) ** 2 + (y - cy) ** 2) * 1.4);

  const col = {
    r: mix(bgTop.r, bgBottom.r, grad) * (0.78 + 0.22 * vignette),
    g: mix(bgTop.g, bgBottom.g, grad) * (0.78 + 0.22 * vignette),
    b: mix(bgTop.b, bgBottom.b, grad) * (0.78 + 0.22 * vignette)
  };

  const ringOuter = alphaFromSdf(sdfCircle(x, y, cx, cy, 0.37), aa);
  const ringInner = alphaFromSdf(-sdfCircle(x, y, cx, cy, 0.33), aa);
  const ring = clamp01(ringOuter * ringInner);
  blend(col, { r: 190, g: 236, b: 255 }, ring * 0.42);

  const head = alphaFromSdf(sdfRoundRect(x, y, cx, cy + 0.01, 0.20, 0.155, 0.07), aa);
  blend(col, { r: 235, g: 247, b: 255 }, head);

  const face = alphaFromSdf(sdfRoundRect(x, y, cx, cy + 0.02, 0.145, 0.095, 0.05), aa);
  blend(col, { r: 16, g: 81, b: 115 }, face);

  const eyeL = alphaFromSdf(sdfCircle(x, y, cx - 0.055, cy + 0.015, 0.022), aa);
  const eyeR = alphaFromSdf(sdfCircle(x, y, cx + 0.055, cy + 0.015, 0.022), aa);
  blend(col, { r: 117, g: 240, b: 255 }, eyeL + eyeR);

  const mouth = alphaFromSdf(sdfRoundRect(x, y, cx, cy + 0.075, 0.055, 0.014, 0.01), aa);
  blend(col, { r: 90, g: 201, b: 236 }, mouth * 0.95);

  const antennaStem = alphaFromSdf(sdfRoundRect(x, y, cx, cy - 0.19, 0.012, 0.045, 0.008), aa);
  const antennaDot = alphaFromSdf(sdfCircle(x, y, cx, cy - 0.255, 0.025), aa);
  blend(col, { r: 228, g: 244, b: 255 }, antennaStem + antennaDot);
  blend(col, { r: 95, g: 232, b: 255 }, antennaDot * 0.45);

  const slashBorder = alphaFromSdf(sdfSegment(x, y, 0.26, 0.77, 0.78, 0.24, 0.065), aa);
  const slashCore = alphaFromSdf(sdfSegment(x, y, 0.26, 0.77, 0.78, 0.24, 0.044), aa);
  blend(col, { r: 250, g: 250, b: 255 }, slashBorder * 0.9);
  blend(col, { r: 239, g: 63, b: 77 }, slashCore);

  const outerBadge = alphaFromSdf(sdfCircle(x, y, cx, cy, 0.47), aa);
  blend(col, { r: 20, g: 70, b: 108 }, (1 - outerBadge) * 0.85);

  return {
    r: Math.round(clamp01(col.r / 255) * 255),
    g: Math.round(clamp01(col.g / 255) * 255),
    b: Math.round(clamp01(col.b / 255) * 255),
    a: 255
  };
}

function makePngRgba(size) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = pngChunk('IHDR', Buffer.concat([
    u32be(size),
    u32be(size),
    Buffer.from([8, 6, 0, 0, 0])
  ]));

  const rawRows = [];
  const aa = 1.2 / size;
  const offsets = [0.25, 0.75];

  for (let py = 0; py < size; py++) {
    const row = Buffer.alloc(1 + size * 4);
    row[0] = 0;

    for (let px = 0; px < size; px++) {
      const acc = { r: 0, g: 0, b: 0, a: 0 };

      for (const oy of offsets) {
        for (const ox of offsets) {
          const nx = (px + ox) / size;
          const ny = (py + oy) / size;
          const s = sampleLogo(nx, ny, aa);
          acc.r += s.r;
          acc.g += s.g;
          acc.b += s.b;
          acc.a += s.a;
        }
      }

      const idx = 1 + px * 4;
      row[idx] = Math.round(acc.r / 4);
      row[idx + 1] = Math.round(acc.g / 4);
      row[idx + 2] = Math.round(acc.b / 4);
      row[idx + 3] = Math.round(acc.a / 4);
    }

    rawRows.push(row);
  }

  const raw = Buffer.concat(rawRows);
  const idat = pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 }));
  const iend = pngChunk('IEND', Buffer.alloc(0));
  return Buffer.concat([sig, ihdr, idat, iend]);
}

const outDir = path.join(__dirname, 'icons');
if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

for (const size of [16, 48, 128, 512]) {
  const png = makePngRgba(size);
  const dest = path.join(outDir, `icon${size}.png`);
  fs.writeFileSync(dest, png);
  console.log(`Created ${dest}`);
}

console.log('Done.');
