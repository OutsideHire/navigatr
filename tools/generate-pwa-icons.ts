/**
 * Generate placeholder PWA icons for apps/app/public/.
 *
 * Produces:
 *   - apps/app/public/icons/icon-{72,96,128,144,152,192,384,512}x{size}.png
 *   - apps/app/public/apple-touch-icon.png         (180x180, iOS home screen)
 *   - apps/app/public/maskable-icon-512.png        (512x512, Android adaptive)
 *   - apps/app/public/favicon.ico                  (32x32, browser tabs)
 *
 * Design: brand-primary indigo square with a centered white "n". Standard
 * icons get a 18.75% corner radius (matches iOS app-icon rounding visually
 * when iOS adds its own mask). Maskable variant is full-bleed with the "n"
 * inside the 80% safe zone so Android's adaptive mask doesn't clip it.
 *
 * Run via `pnpm icons:generate` from the monorepo root. Outputs are committed.
 *
 * This is run once per icon refresh — not on every install. Real navigatr
 * branding replaces these in production.
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import sharp from "sharp";

/**
 * Build a single-entry ICO containing one PNG. The PNG-in-ICO format has been
 * supported by every browser since IE6 / Vista, and yields a ~500-byte
 * favicon (vs. the multi-size auto-padding libraries produce).
 *
 *   ICONDIR  (6 B) :  reserved=0, type=1, count=1
 *   ICONDIRENTRY (16 B) : w, h, colors=0, reserved=0, planes=1, bpp=32,
 *                         size=PNG.length, offset=22
 *   payload  : the PNG bytes verbatim
 */
function buildIco(png: Buffer, size = 32): Buffer {
  const dir = Buffer.alloc(6);
  dir.writeUInt16LE(0, 0);
  dir.writeUInt16LE(1, 2);
  dir.writeUInt16LE(1, 4);

  const entry = Buffer.alloc(16);
  entry.writeUInt8(size >= 256 ? 0 : size, 0); // 0 means 256 in ICO spec
  entry.writeUInt8(size >= 256 ? 0 : size, 1);
  entry.writeUInt8(0, 2);
  entry.writeUInt8(0, 3);
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(png.length, 8);
  entry.writeUInt32LE(6 + 16, 12);

  return Buffer.concat([dir, entry, png]);
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC = resolve(__dirname, "..", "apps/app/public");
const ICONS_DIR = resolve(PUBLIC, "icons");

// Match the brand-primary swatch in figma-export.json / manifest theme_color.
const ICON_BG = "#5856EB";
const ICON_FG = "#FFFFFF";

interface TemplateOpts {
  /** Corner radius as a fraction of size. iOS-style is ~0.18-0.20. */
  cornerRadiusRatio?: number;
  /** Inner content as a fraction of canvas (for maskable safe zone). */
  safeZoneRatio?: number;
}

function template(size: number, opts: TemplateOpts = {}): string {
  const { cornerRadiusRatio = 0.1875, safeZoneRatio = 1.0 } = opts;
  const r = Math.round(size * cornerRadiusRatio);
  // Glyph sized to ~62% of the safe zone — visually centered with optical
  // adjustment (slight downward shift so the "n"'s baseline sits centered).
  const glyphHeight = size * safeZoneRatio;
  const fontSize = Math.round(glyphHeight * 0.62);
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${r}" ry="${r}" fill="${ICON_BG}"/>
  <text x="50%" y="50%" font-family="Inter, system-ui, -apple-system, sans-serif" font-size="${fontSize}" font-weight="700" fill="${ICON_FG}" text-anchor="middle" dominant-baseline="central">n</text>
</svg>`;
}

async function svgToPng(svg: string, size: number): Promise<Buffer> {
  return sharp(Buffer.from(svg), { density: 384 })
    .resize(size, size, { fit: "contain" })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

const STANDARD_SIZES = [72, 96, 128, 144, 152, 192, 384, 512] as const;

async function main(): Promise<void> {
  mkdirSync(ICONS_DIR, { recursive: true });

  // Standard square-with-rounded-corners icons (purpose: "any").
  for (const size of STANDARD_SIZES) {
    const svg = template(size, { cornerRadiusRatio: 0.1875 });
    const png = await svgToPng(svg, size);
    const path = resolve(ICONS_DIR, `icon-${size}x${size}.png`);
    writeFileSync(path, png);
    console.log(`  ✔ icons/icon-${size}x${size}.png  (${png.byteLength.toLocaleString()} B)`);
  }

  // Apple touch icon — iOS rounds it itself; ship a slightly rounded square
  // so it looks fine on older iOS that doesn't re-mask.
  {
    const svg = template(180, { cornerRadiusRatio: 0.1875 });
    const png = await svgToPng(svg, 180);
    writeFileSync(resolve(PUBLIC, "apple-touch-icon.png"), png);
    console.log(`  ✔ apple-touch-icon.png         (${png.byteLength.toLocaleString()} B)`);
  }

  // Maskable icon — full-bleed background, "n" inside 80% safe zone.
  // Android will mask the outer 10% on each side with the device's adaptive
  // icon shape (circle/squircle/etc.), so corner radius is irrelevant here.
  {
    const svg = template(512, { cornerRadiusRatio: 0, safeZoneRatio: 0.8 });
    const png = await svgToPng(svg, 512);
    writeFileSync(resolve(PUBLIC, "maskable-icon-512.png"), png);
    console.log(`  ✔ maskable-icon-512.png        (${png.byteLength.toLocaleString()} B)`);
  }

  // favicon.ico — PNG-in-ICO at 32×32. Single entry, ~500 bytes total.
  {
    const svg = template(32, { cornerRadiusRatio: 0.1875 });
    const png32 = await svgToPng(svg, 32);
    const ico = buildIco(png32, 32);
    writeFileSync(resolve(PUBLIC, "favicon.ico"), ico);
    console.log(`  ✔ favicon.ico                  (${ico.byteLength.toLocaleString()} B)`);
  }

  console.log("\n✔ done — regenerate any time with `pnpm icons:generate`");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
