/**
 * 앱 아이콘 PNG 생성기 (외부 의존성 없음).
 * 연꽃빛 그러데이션 위에 흰 말풍선을 얹은 단순한 아이콘.
 *
 *   node tools/make-icons.mjs
 */

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

const OUT = new URL('../assets/icons/', import.meta.url);
mkdirSync(OUT, { recursive: true });

/* --- 최소 PNG 인코더 ------------------------------------------------ */

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = c ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePNG(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* --- 그리기 ---------------------------------------------------------- */

const mix = (a, b, t) => a + (b - a) * t;
const clamp01 = (v) => Math.max(0, Math.min(1, v));

/** 둥근 사각형까지의 부호 있는 거리 (안쪽이 음수) */
function sdRoundRect(px, py, cx, cy, hw, hh, r) {
  const dx = Math.abs(px - cx) - (hw - r);
  const dy = Math.abs(py - cy) - (hh - r);
  const ax = Math.max(dx, 0), ay = Math.max(dy, 0);
  return Math.hypot(ax, ay) + Math.min(Math.max(dx, dy), 0) - r;
}

function draw(size, { maskable = false } = {}) {
  const buf = Buffer.alloc(size * size * 4);
  const S = size;
  const pad = maskable ? S * 0.18 : 0;
  const inner = S - pad * 2;

  // 말풍선 기하 (아이콘 안쪽 기준)
  const bw = inner * 0.62, bh = inner * 0.46;
  const bx = pad + inner * 0.5, by = pad + inner * 0.46;
  const r = bh * 0.42;

  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = (y * S + x) * 4;
      const t = clamp01((x / S) * 0.35 + (y / S) * 0.65);

      // 배경: 사프란 → 자홍 (인도 색감)
      let R = mix(240, 194, t);
      let G = mix(162, 24, t);
      let B = mix(2, 91, t);
      let A = 255;

      if (maskable) {
        // 마스커블은 꽉 찬 사각형
      } else {
        // iOS 스퀘어클 느낌의 둥근 모서리
        const d = sdRoundRect(x + 0.5, y + 0.5, S / 2, S / 2, S / 2, S / 2, S * 0.225);
        A = Math.round(255 * clamp01(0.5 - d));
      }

      // 흰 말풍선
      const db = sdRoundRect(x + 0.5, y + 0.5, bx, by, bw / 2, bh / 2, r);
      // 꼬리
      const tailX = bx - bw * 0.30, tailY = by + bh * 0.40;
      const dt = Math.hypot((x + 0.5 - tailX) * 1.15, (y + 0.5 - tailY) * 0.78) - bh * 0.16;
      const bubble = clamp01(0.5 - Math.min(db, dt));

      if (bubble > 0) {
        R = mix(R, 255, bubble);
        G = mix(G, 255, bubble);
        B = mix(B, 255, bubble);
      }

      // 말풍선 안 세 점
      const dotR = bh * 0.085;
      for (let k = -1; k <= 1; k++) {
        const dxp = x + 0.5 - (bx + k * bw * 0.22);
        const dyp = y + 0.5 - by;
        const dd = clamp01(0.5 - (Math.hypot(dxp, dyp) - dotR));
        if (dd > 0) {
          R = mix(R, 214, dd * 0.92);
          G = mix(G, 51, dd * 0.92);
          B = mix(B, 108, dd * 0.92);
        }
      }

      buf[i] = Math.round(R);
      buf[i + 1] = Math.round(G);
      buf[i + 2] = Math.round(B);
      buf[i + 3] = A;
    }
  }
  return encodePNG(S, S, buf);
}

const targets = [
  ['icon-192.png', 192, {}],
  ['icon-512.png', 512, {}],
  ['maskable-512.png', 512, { maskable: true }],
  ['apple-touch-icon.png', 180, { maskable: true }], // iOS가 알아서 모서리를 깎는다
];

for (const [name, size, opts] of targets) {
  const png = draw(size, opts);
  writeFileSync(new URL(name, OUT), png);
  console.log(`${name} — ${size}×${size}, ${(png.length / 1024).toFixed(1)}KB`);
}
