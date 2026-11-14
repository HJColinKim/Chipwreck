// One-shot generator for the homescreen/manifest icons in docs/.
// Run `npm run icons` and commit the PNGs. The build deliberately does NOT regenerate
// them: zlib output is not guaranteed stable across Node versions, and `npm run build:check`
// compares the committed bytes of docs/ against a fresh build.
//
// Draws the $100 chip from src/app.ts: ink body, mustard edge stripes and inner ring,
// on the felt background the app boots to.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib'; // zlib.crc32 requires Node >= 20.15

const FELT = [0x33, 0x69, 0x4c];
const INK = [0x14, 0x1a, 0x17];
const MUSTARD = [0xe3, 0xc3, 0x5a];
const PALETTE = [FELT, INK, MUSTARD];

const SS = 4; // supersample steps per axis — enough to keep the chip rim smooth at 180px
// 8 stripes rather than the app's 12: at icon sizes a 30deg period turns to mush.
const STRIPE_PERIOD = 45;
const STRIPE_INK = 30;

// Which palette entry covers a point, measured from the chip centre.
// Rings outward: ink face, mustard ring, ink gap, inset stripe band, ink rim.
function sampleAt(dx, dy, radius) {
  const r = Math.hypot(dx, dy) / radius;
  if (r > 1) return 0;
  if (r <= 0.56) return 1;
  if (r <= 0.63) return 2;
  if (r <= 0.72 || r > 0.93) return 1;
  const angle = Math.atan2(dy, dx) * 180 / Math.PI + 180;
  return angle % STRIPE_PERIOD < STRIPE_INK ? 1 : 2;
}

function renderRGB(size, chipScale) {
  const rgb = Buffer.alloc(size * size * 3);
  const radius = (size / 2) * chipScale;
  const centre = size / 2;
  const samples = SS * SS;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const c = PALETTE[sampleAt(x + (sx + 0.5) / SS - centre, y + (sy + 0.5) / SS - centre, radius)];
          r += c[0]; g += c[1]; b += c[2];
        }
      }
      const o = (y * size + x) * 3;
      rgb[o] = Math.round(r / samples);
      rgb[o + 1] = Math.round(g / samples);
      rgb[o + 2] = Math.round(b / samples);
    }
  }
  return rgb;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePNG(size, rgb) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour RGB, no alpha — the icon is a full opaque square
  const stride = size * 3 + 1;
  const raw = Buffer.alloc(size * stride);
  for (let y = 0; y < size; y++) {
    raw[y * stride] = 0; // filter: none
    rgb.copy(raw, y * stride + 1, y * size * 3, (y + 1) * size * 3);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Maskable icons get cropped to a circle inset ~10%, so the chip shrinks into the safe zone.
const ICONS = [
  { file: 'icon-192.png', size: 192, chipScale: 0.86 },
  { file: 'icon-512.png', size: 512, chipScale: 0.86 },
  { file: 'icon-180.png', size: 180, chipScale: 0.86 }, // apple-touch-icon
  { file: 'icon-maskable-512.png', size: 512, chipScale: 0.60 },
];

const outDir = path.join(import.meta.dirname, '..', 'docs');
fs.mkdirSync(outDir, { recursive: true });
for (const icon of ICONS) {
  const png = encodePNG(icon.size, renderRGB(icon.size, icon.chipScale));
  fs.writeFileSync(path.join(outDir, icon.file), png);
  console.log('wrote docs/%s (%dx%d, %d bytes)', icon.file, icon.size, icon.size, png.length);
}
