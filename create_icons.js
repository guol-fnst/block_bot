/**
 * create_icons.js
 * Generates icons/icon16.png, icons/icon48.png, icons/icon128.png
 * using only Node.js built-ins (no npm dependencies needed).
 *
 * Usage:  node create_icons.js
 */
'use strict';

const zlib = require('zlib');
const fs   = require('fs');
const path = require('path');

// ── CRC-32 ────────────────────────────────────────────────────────────────────
function buildCrcTable() {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : (c >>> 1);
    t[n] = c;
  }
  return t;
}
const CRC_TABLE = buildCrcTable();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
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
  return Buffer.concat([u32be(d.length), t, d, u32be(crc32(Buffer.concat([t, d])))]);
}

// ── PNG builder (solid-colour square) ────────────────────────────────────────
function makePng(size, r, g, b) {
  const sig  = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = pngChunk('IHDR',
    Buffer.concat([u32be(size), u32be(size), Buffer.from([8, 2, 0, 0, 0])])
  );

  // Raw image data: one filter byte (0 = None) + RGB pixels per row
  const row = Buffer.alloc(1 + size * 3);
  for (let x = 0; x < size; x++) {
    row[1 + x * 3] = r;
    row[2 + x * 3] = g;
    row[3 + x * 3] = b;
  }
  const raw  = Buffer.concat(Array.from({ length: size }, () => row));
  const idat = pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 }));
  const iend = pngChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([sig, ihdr, idat, iend]);
}

// ── Main ──────────────────────────────────────────────────────────────────────
const outDir = path.join(__dirname, 'icons');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

// X-blue  #1d9bf0  → rgb(29, 155, 240)
for (const size of [16, 48, 128]) {
  const png  = makePng(size, 29, 155, 240);
  const dest = path.join(outDir, `icon${size}.png`);
  fs.writeFileSync(dest, png);
  console.log(`Created  ${dest}`);
}
console.log('Done.');
