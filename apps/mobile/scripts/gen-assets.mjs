/**
 * Zero-dependency PNG writer for the four assets `app.config.ts` binds:
 * `icon.png`, `adaptive-icon.png`, `splash.png`, `notification-icon.png`.
 * No npm image library — just `node:zlib`'s deflate + CRC32 and a hand-written
 * PNG chunk writer, so the repo does not gain a new devDependency for four
 * flat-color monograms. Source: brand-500 in `../src/theme/tokens.ts`
 * (`#2d67fa`, checked against it by `src/__tests__/assets.test.ts`) and a
 * plain block "N" — no external artwork is copied (13.7-u).
 *
 * Deterministic: every byte here comes from the constants below, so
 * re-running this script reproduces the committed PNGs exactly (`git status`
 * on `assets/` stays clean).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';

const HERE = dirname(fileURLToPath(import.meta.url));
const ASSETS_DIR = join(HERE, '..', 'assets');

const BRAND_500 = [0x2d, 0x67, 0xfa, 0xff]; // apps/mobile/src/theme/tokens.ts COLORS.light.brand500
const WHITE = [0xff, 0xff, 0xff, 0xff];
const TRANSPARENT = [0x00, 0x00, 0x00, 0x00];

/** One length-prefixed, CRC-suffixed PNG chunk. */
function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])) >>> 0, 0);
  return Buffer.concat([length, typeBuf, data, crcBuf]);
}

/** `rgba` is `width * height * 4` bytes, row-major, no padding. */
function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: truecolor + alpha
  // interlace/compression/filter method bytes stay 0 (Buffer.alloc default).
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0; // per-scanline filter type: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** A flat canvas of one RGBA color. */
function canvas(width, height, color) {
  const buf = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i += 1) buf.set(color, i * 4);
  return buf;
}

/**
 * A plain block "N" — two vertical strokes and one diagonal, inside a
 * centered square that is `sizeFraction` of the canvas. Not rendered
 * typography; a monogram is all 13.7-u's KAPSAM DIŞI allows.
 */
function drawMonogramN(buf, width, height, sizeFraction, color) {
  const glyph = Math.round(Math.min(width, height) * sizeFraction);
  const x0 = Math.round((width - glyph) / 2);
  const y0 = Math.round((height - glyph) / 2);
  const stroke = Math.max(1, Math.round(glyph * 0.16));
  for (let y = y0; y < y0 + glyph; y += 1) {
    const t = (y - y0) / (glyph - 1);
    const diagonalX = x0 + t * (glyph - 1);
    for (let x = x0; x < x0 + glyph; x += 1) {
      const onLeft = x < x0 + stroke;
      const onRight = x >= x0 + glyph - stroke;
      const onDiagonal = Math.abs(x - diagonalX) <= stroke / 2;
      if (onLeft || onRight || onDiagonal) buf.set(color, (y * width + x) * 4);
    }
  }
}

function monogramPng(width, height, background, foreground, sizeFraction) {
  const buf = canvas(width, height, background);
  drawMonogramN(buf, width, height, sizeFraction, foreground);
  return encodePng(width, height, buf);
}

const ASSETS = [
  // Full app icon: opaque brand background, margin for the OS's own icon mask.
  ['icon.png', () => monogramPng(1024, 1024, BRAND_500, WHITE, 0.5)],
  // Android adaptive icon foreground layer only — transparent background
  // (colored by `android.adaptiveIcon.backgroundColor` in app.config.ts) and
  // a smaller glyph so it survives circle/squircle mask cropping.
  ['adaptive-icon.png', () => monogramPng(1024, 1024, TRANSPARENT, WHITE, 0.42)],
  // Splash background. Not wired into app.config.ts: SDK 57's `@expo/config-
  // types` dropped the root `splash` field (same story as `newArchEnabled` in
  // 13.7-t) — a real splash screen needs the `expo-splash-screen` config
  // plugin, which this task does not add. Generated so it is ready for that.
  ['splash.png', () => monogramPng(1024, 1024, BRAND_500, WHITE, 0.35)],
  // Android status-bar notification icon: must be a white silhouette with
  // alpha only — the system tints it, and rejects/ignores any other color.
  ['notification-icon.png', () => monogramPng(96, 96, TRANSPARENT, WHITE, 0.6)],
];

mkdirSync(ASSETS_DIR, { recursive: true });
for (const [name, build] of ASSETS) {
  writeFileSync(join(ASSETS_DIR, name), build());
}
