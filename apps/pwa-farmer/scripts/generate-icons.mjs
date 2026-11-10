// Draws the app icons with no image dependencies: a white sprout on solid green, encoded as PNG by hand.
// Run with `node scripts/generate-icons.mjs` to regenerate public/icons/.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
mkdirSync(out, { recursive: true });

const GREEN = [6, 95, 70];
const WHITE = [255, 255, 255];

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const t = Buffer.from(type);
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
};
const png = (size, pixel) => {
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y++) {
    const row = y * (size * 3 + 1);
    for (let x = 0; x < size; x++) raw.set(pixel(x, y), row + 1 + x * 3);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
};

// A leaf is the overlap of two circles; coordinates are in a 0..1 unit square.
const inCircle = (x, y, cx, cy, r) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
const sprout = (u, v) => {
  const stem = Math.abs(u - 0.5) < 0.028 && v > 0.42 && v < 0.82;
  const left = inCircle(u, v, 0.42, 0.5, 0.2) && inCircle(u, v, 0.27, 0.34, 0.2);
  const right = inCircle(u, v, 0.58, 0.44, 0.2) && inCircle(u, v, 0.73, 0.28, 0.2);
  const ground = Math.abs(v - 0.82) < 0.025 && Math.abs(u - 0.5) < 0.2;
  return stem || left || right || ground;
};
// `scale` shrinks the artwork so that a maskable icon survives the launcher's circular crop.
const draw = (size, scale = 1) => png(size, (x, y) => {
  const u = ((x + 0.5) / size - 0.5) / scale + 0.5;
  const v = ((y + 0.5) / size - 0.5) / scale + 0.5;
  return sprout(u, v) ? WHITE : GREEN;
});

writeFileSync(join(out, 'icon-192.png'), draw(192));
writeFileSync(join(out, 'icon-512.png'), draw(512));
writeFileSync(join(out, 'maskable-512.png'), draw(512, 0.72));
writeFileSync(join(out, 'apple-touch-icon.png'), draw(180));
console.log(`Icons written to ${out}`);
