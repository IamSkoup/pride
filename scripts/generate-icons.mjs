import sharp from 'sharp';
import { readFileSync } from 'node:fs';

const svg = readFileSync('public/icon.svg');
for (const size of [180, 192, 512]) {
  await sharp(svg).resize(size, size).png().toFile(`public/icon-${size}.png`);
}
console.log('PWA icons generated');
