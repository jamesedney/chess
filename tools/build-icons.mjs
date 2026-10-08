// Render the app icons from the cburnett knight in the Rankup palette.
// Usage: node tools/build-icons.mjs   (uses the Playwright Chromium)
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const BG = '#a6521f'; // --accent
const KNIGHT = '#f6f1e8'; // --paper

// The cburnett black knight: body in paper, eye, nostril and mane line in the background colour.
const knight = `<g fill="none" fill-rule="evenodd" stroke="${KNIGHT}" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5">
  <path fill="${KNIGHT}" d="M22 10c10.5 1 16.5 8 16 29H15c0-9 10-6.5 8-21"/>
  <path fill="${KNIGHT}" d="M24 18c.38 2.91-5.55 7.37-8 9-3 2-2.82 4.34-5 4-1.04-.94 1.41-3.04 0-3-1 0 .19 1.23-1 2-1 0-4 1-4-4 0-2 6-12 6-12s1.89-1.9 2-3.5c-.73-1-.5-2-.5-3 1-1 3 2.5 3 2.5h2s.78-2 2.5-3c1 0 1 3 1 3"/>
  <path fill="${BG}" stroke="${BG}" d="M9.5 25.5a.5.5 0 1 1-1 0 .5.5 0 1 1 1 0m5.43-9.75a.5 1.5 30 1 1-.86-.5.5 1.5 30 1 1 .86.5"/>
  <path fill="${BG}" stroke="none" d="m24.55 10.4-.45 1.45.5.15c3.15 1 5.65 2.49 7.9 6.75S35.75 29.06 35.25 39l-.05.5h2.25l.05-.5c.5-10.06-.88-16.85-3.25-21.34s-5.79-6.64-9.19-7.16z"/>
</g>`;

/** An icon `size` px square with the knight filling `scale` of it, centred on its bounding box. */
function svg(size, scale) {
  // The knight's drawn extent in its 45-unit box is about x 6–39, y 9–40.
  const box = { x: 6, y: 9, w: 33, h: 31 };
  const k = (size * scale) / Math.max(box.w, box.h);
  const tx = size / 2 - (box.x + box.w / 2) * k;
  const ty = size / 2 - (box.y + box.h / 2) * k;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="${BG}"/>
  <g transform="translate(${tx} ${ty}) scale(${k})">${knight}</g>
</svg>`;
}

const ICONS = [
  { file: 'icon-192.png', size: 192, scale: 0.52 },
  { file: 'icon-512.png', size: 512, scale: 0.52 },
  // Maskable icons are cropped to a circle of 80%: keep the knight well inside it.
  { file: 'icon-maskable-512.png', size: 512, scale: 0.42 },
  { file: 'apple-touch-icon.png', size: 180, scale: 0.54 },
];

const browser = await chromium.launch();
const page = await browser.newPage();
for (const { file, size, scale } of ICONS) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0">${svg(size, scale)}</body></html>`);
  const out = path.join(ROOT, 'icons', file);
  fs.writeFileSync(out, await page.locator('svg').screenshot({ omitBackground: false }));
  console.log('wrote', path.relative(ROOT, out));
}
await browser.close();
