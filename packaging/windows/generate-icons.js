/**
 * LedgerAI PH — High-Resolution Standards-Compliant Windows ICO Generator
 *
 * Generates native DIB (BITMAPINFOHEADER) encoded multi-resolution Windows ICO files:
 * - packaging/windows/assets/app-icon.ico
 * - packaging/windows/assets/keygenerator-icon.ico
 *
 * Supported Sizes: 256x256, 128x128, 64x64, 48x48, 32x32, 16x16 (32-bit RGBA)
 * Fully compatible with resedit, app-builder-lib, electron-builder, and NSIS PE resource embedding.
 */

import fs from 'fs';
import path from 'path';

const SIZES = [256, 128, 64, 48, 32, 16];

// Helper: 2D Pixel Canvas with Anti-Aliased RGBA Drawing
function createCanvas(width, height) {
  const data = new Uint8Array(width * height * 4);

  function setPixel(x, y, r, g, b, a = 255) {
    x = Math.floor(x);
    y = Math.floor(y);
    if (x < 0 || x >= width || y < 0 || y >= height) return;
    const idx = (y * width + x) * 4;
    if (a >= 255) {
      data[idx] = Math.min(255, Math.max(0, Math.round(r)));
      data[idx + 1] = Math.min(255, Math.max(0, Math.round(g)));
      data[idx + 2] = Math.min(255, Math.max(0, Math.round(b)));
      data[idx + 3] = 255;
    } else if (a > 0) {
      const alpha = a / 255;
      const invAlpha = 1 - alpha;
      data[idx] = Math.min(255, Math.max(0, Math.round(r * alpha + data[idx] * invAlpha)));
      data[idx + 1] = Math.min(255, Math.max(0, Math.round(g * alpha + data[idx + 1] * invAlpha)));
      data[idx + 2] = Math.min(255, Math.max(0, Math.round(b * alpha + data[idx + 2] * invAlpha)));
      data[idx + 3] = Math.min(255, Math.round(data[idx + 3] + a));
    }
  }

  function fillRect(x0, y0, w, h, color) {
    const [r, g, b, a = 255] = color;
    for (let y = Math.max(0, Math.floor(y0)); y < Math.min(height, Math.ceil(y0 + h)); y++) {
      for (let x = Math.max(0, Math.floor(x0)); x < Math.min(width, Math.ceil(x0 + w)); x++) {
        setPixel(x, y, r, g, b, a);
      }
    }
  }

  function fillRoundedRect(x0, y0, w, h, radius, colorFn, strokeColor = null, strokeWidth = 0) {
    for (let py = Math.max(0, Math.floor(y0)); py < Math.min(height, Math.ceil(y0 + h)); py++) {
      for (let px = Math.max(0, Math.floor(x0)); px < Math.min(width, Math.ceil(x0 + w)); px++) {
        const lx = px - x0;
        const ly = py - y0;
        let distCorner = 0;

        if (lx < radius && ly < radius) {
          distCorner = Math.sqrt((lx - radius) ** 2 + (ly - radius) ** 2) - radius;
        } else if (lx >= w - radius && ly < radius) {
          distCorner = Math.sqrt((lx - (w - radius)) ** 2 + (ly - radius) ** 2) - radius;
        } else if (lx < radius && ly >= h - radius) {
          distCorner = Math.sqrt((lx - radius) ** 2 + (ly - (h - radius)) ** 2) - radius;
        } else if (lx >= w - radius && ly >= h - radius) {
          distCorner = Math.sqrt((lx - (w - radius)) ** 2 + (ly - (h - radius)) ** 2) - radius;
        }

        if (distCorner <= 0.5) {
          const alpha = distCorner < -0.5 ? 255 : Math.round((0.5 - distCorner) * 255);
          
          if (strokeColor && strokeWidth > 0 && distCorner >= -strokeWidth) {
            const [sr, sg, sb, sa = 255] = strokeColor;
            setPixel(px, py, sr, sg, sb, Math.min(sa, alpha));
          } else {
            const [r, g, b, a = 255] = colorFn(lx / w, ly / h);
            setPixel(px, py, r, g, b, Math.min(a, alpha));
          }
        }
      }
    }
  }

  function fillCircle(cx, cy, r, color, strokeColor = null, strokeWidth = 0) {
    const [cr, cg, cb, ca = 255] = color;
    const minX = Math.max(0, Math.floor(cx - r - strokeWidth - 1));
    const maxX = Math.min(width - 1, Math.ceil(cx + r + strokeWidth + 1));
    const minY = Math.max(0, Math.floor(cy - r - strokeWidth - 1));
    const maxY = Math.min(height - 1, Math.ceil(cy + r + strokeWidth + 1));

    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
        if (dist <= r + strokeWidth + 0.5) {
          if (strokeColor && strokeWidth > 0 && dist >= r - strokeWidth / 2) {
            const [sr, sg, sb, sa = 255] = strokeColor;
            const alpha = dist > r + strokeWidth - 0.5 ? Math.round((r + strokeWidth + 0.5 - dist) * sa) : sa;
            setPixel(x, y, sr, sg, sb, Math.max(0, Math.min(255, alpha)));
          } else if (dist <= r + 0.5) {
            const alpha = dist > r - 0.5 ? Math.round((r + 0.5 - dist) * ca) : ca;
            setPixel(x, y, cr, cg, cb, Math.max(0, Math.min(255, alpha)));
          }
        }
      }
    }
  }

  function drawLine(x1, y1, x2, y2, thickness, color) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len === 0) return;
    const steps = Math.ceil(len * 2);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const cx = x1 + dx * t;
      const cy = y1 + dy * t;
      fillCircle(cx, cy, thickness / 2, color);
    }
  }

  return {
    width, height, data,
    setPixel, fillRect, fillRoundedRect, fillCircle, drawLine
  };
}

// -------------------------------------------------------------------------
// Render Artwork: Client App Icon
// -------------------------------------------------------------------------
function renderAppIconCanvas(size) {
  const canvas = createCanvas(size, size);
  const s = size / 256;

  // Background Container (Rounded Navy App Shield)
  const margin = 12 * s;
  const w = size - margin * 2;
  const h = size - margin * 2;
  const radius = 48 * s;
  const strokeW = Math.max(1, 3.5 * s);

  canvas.fillRoundedRect(
    margin, margin, w, h, radius,
    (u, v) => [
      Math.round(15 + u * 10),
      Math.round(23 + v * 15),
      Math.round(42 + v * 20),
      255
    ],
    [99, 102, 241, 220],
    strokeW
  );

  // Left Sheet: Accounting Ledger Book
  const bookX = margin + 36 * s;
  const bookY = margin + 36 * s;
  const bookW = 68 * s;
  const bookH = 132 * s;
  const bookR = 10 * s;

  canvas.fillRoundedRect(
    bookX, bookY, bookW, bookH, bookR,
    (u, v) => [
      Math.round(59 + v * 20),
      Math.round(130 - v * 30),
      Math.round(246 - v * 20),
      255
    ]
  );

  // White Ruled Lines
  if (size >= 32) {
    const lineThick = Math.max(1, 2.5 * s);
    canvas.drawLine(bookX + 12 * s, bookY + 30 * s, bookX + 56 * s, bookY + 30 * s, lineThick, [255, 255, 255, 230]);
    canvas.drawLine(bookX + 12 * s, bookY + 54 * s, bookX + 56 * s, bookY + 54 * s, lineThick, [255, 255, 255, 180]);
    canvas.drawLine(bookX + 12 * s, bookY + 78 * s, bookX + 44 * s, bookY + 78 * s, lineThick, [255, 255, 255, 140]);
    canvas.drawLine(bookX + 12 * s, bookY + 102 * s, bookX + 50 * s, bookY + 102 * s, lineThick, [255, 255, 255, 100]);
  }

  // Right Side: AI Growth Vector & Tax Emblem
  const goldX = margin + 116 * s;
  const goldY = margin + 36 * s;
  const goldW = 68 * s;
  const goldH = 132 * s;
  const goldR = 10 * s;

  canvas.fillRoundedRect(
    goldX, goldY, goldW, goldH, goldR,
    (u, v) => [
      Math.round(245 - v * 229),
      Math.round(158 + v * 27),
      Math.round(11 + v * 118),
      255
    ]
  );

  // Growth Checkmark
  if (size >= 32) {
    const vecThick = Math.max(1.5, 3.5 * s);
    canvas.drawLine(goldX + 16 * s, goldY + 70 * s, goldX + 32 * s, goldY + 88 * s, vecThick, [255, 255, 255, 240]);
    canvas.drawLine(goldX + 32 * s, goldY + 88 * s, goldX + 54 * s, goldY + 48 * s, vecThick, [255, 255, 255, 240]);
  }

  // Center Core: AI Synapse Node
  const cx = size / 2;
  const cy = size / 2;
  const rCore = Math.max(2, 16 * s);
  const rRing = Math.max(3, 24 * s);

  canvas.fillCircle(cx, cy, rCore, [255, 255, 255, 255]);
  canvas.fillCircle(cx, cy, rRing, [56, 189, 248, 0], [56, 189, 248, 220], Math.max(1, 3 * s));

  // "PH" Tag Badge
  if (size >= 48) {
    const badgeW = 44 * s;
    const badgeH = 22 * s;
    const badgeX = size - margin - badgeW - 12 * s;
    const badgeY = size - margin - badgeH - 12 * s;

    canvas.fillRoundedRect(
      badgeX, badgeY, badgeW, badgeH, 6 * s,
      () => [30, 27, 75, 250],
      [99, 102, 241, 200],
      Math.max(1, 1.5 * s)
    );

    const px = badgeX + 10 * s;
    const py = badgeY + 5 * s;
    const pt = Math.max(1, 2 * s);
    canvas.drawLine(px, py, px, py + 12 * s, pt, [224, 231, 255, 255]);
    canvas.drawLine(px, py, px + 8 * s, py, pt, [224, 231, 255, 255]);
    canvas.drawLine(px + 8 * s, py, px + 8 * s, py + 6 * s, pt, [224, 231, 255, 255]);
    canvas.drawLine(px + 8 * s, py + 6 * s, px, py + 6 * s, pt, [224, 231, 255, 255]);

    const hx = badgeX + 24 * s;
    const hy = badgeY + 5 * s;
    canvas.drawLine(hx, hy, hx, hy + 12 * s, pt, [224, 231, 255, 255]);
    canvas.drawLine(hx + 8 * s, hy, hx + 8 * s, hy + 12 * s, pt, [224, 231, 255, 255]);
    canvas.drawLine(hx, hy + 6 * s, hx + 8 * s, hy + 6 * s, pt, [224, 231, 255, 255]);
  }

  return canvas.data;
}

// -------------------------------------------------------------------------
// Render Artwork: Key Generator Icon
// -------------------------------------------------------------------------
function renderKeyGenIconCanvas(size) {
  const canvas = createCanvas(size, size);
  const s = size / 256;

  // Background Container (Obsidian Authority Shield)
  const margin = 12 * s;
  const w = size - margin * 2;
  const h = size - margin * 2;
  const radius = 48 * s;
  const strokeW = Math.max(1, 4 * s);

  canvas.fillRoundedRect(
    margin, margin, w, h, radius,
    (u, v) => [
      Math.round(9 + u * 6),
      Math.round(13 + v * 10),
      Math.round(22 + v * 15),
      255
    ],
    [245, 158, 11, 230],
    strokeW
  );

  // Security Shield Background
  const shieldX = margin + 32 * s;
  const shieldY = margin + 28 * s;
  const shieldW = 144 * s;
  const shieldH = 152 * s;

  canvas.fillRoundedRect(
    shieldX, shieldY, shieldW, shieldH, 24 * s,
    () => [30, 24, 10, 180],
    [217, 119, 6, 120],
    Math.max(1, 2 * s)
  );

  // Golden Security Master Key
  const bowCx = size * 0.38;
  const bowCy = size * 0.48;
  const bowR = Math.max(4, 34 * s);
  const bowHoleR = Math.max(2, 15 * s);

  canvas.fillCircle(bowCx, bowCy, bowR, [245, 158, 11, 255], [251, 191, 36, 255], Math.max(1, 2 * s));
  canvas.fillCircle(bowCx, bowCy, bowHoleR, [15, 23, 42, 255]);

  const shaftX = bowCx + bowR - 4 * s;
  const shaftY = bowCy - 7 * s;
  const shaftW = 82 * s;
  const shaftH = 14 * s;

  canvas.fillRect(shaftX, shaftY, shaftW, shaftH, [245, 158, 11, 255]);

  const tooth1X = shaftX + shaftW - 28 * s;
  const tooth1Y = shaftY + shaftH;
  const tooth1W = 10 * s;
  const tooth1H = 22 * s;

  const tooth2X = shaftX + shaftW - 12 * s;
  const tooth2Y = shaftY + shaftH;
  const tooth2W = 10 * s;
  const tooth2H = 16 * s;

  canvas.fillRect(tooth1X, tooth1Y, tooth1W, tooth1H, [245, 158, 11, 255]);
  canvas.fillRect(tooth2X, tooth2Y, tooth2W, tooth2H, [245, 158, 11, 255]);

  const starR = Math.max(1.5, 6 * s);
  canvas.fillCircle(bowCx, bowCy, starR, [255, 255, 255, 255]);

  if (size >= 48) {
    const badgeW = 58 * s;
    const badgeH = 22 * s;
    const badgeX = size - margin - badgeW - 12 * s;
    const badgeY = size - margin - badgeH - 12 * s;

    canvas.fillRoundedRect(
      badgeX, badgeY, badgeW, badgeH, 6 * s,
      () => [69, 26, 3, 240],
      [245, 158, 11, 220],
      Math.max(1, 1.5 * s)
    );

    const ax = badgeX + 8 * s;
    const ay = badgeY + 5 * s;
    const pt = Math.max(1, 1.8 * s);
    canvas.drawLine(ax, ay + 12 * s, ax + 4 * s, ay, pt, [254, 243, 199, 255]);
    canvas.drawLine(ax + 4 * s, ay, ax + 8 * s, ay + 12 * s, pt, [254, 243, 199, 255]);
    canvas.drawLine(ax + 2 * s, ay + 7 * s, ax + 6 * s, ay + 7 * s, pt, [254, 243, 199, 255]);

    const ux = badgeX + 20 * s;
    const uy = badgeY + 5 * s;
    canvas.drawLine(ux, uy, ux, uy + 10 * s, pt, [254, 243, 199, 255]);
    canvas.drawLine(ux, uy + 10 * s, ux + 7 * s, uy + 10 * s, pt, [254, 243, 199, 255]);
    canvas.drawLine(ux + 7 * s, uy, ux + 7 * s, uy + 10 * s, pt, [254, 243, 199, 255]);

    const tx = badgeX + 32 * s;
    const ty = badgeY + 5 * s;
    canvas.drawLine(tx, ty, tx + 8 * s, ty, pt, [254, 243, 199, 255]);
    canvas.drawLine(tx + 4 * s, ty, tx + 4 * s, ty + 12 * s, pt, [254, 243, 199, 255]);
  }

  return canvas.data;
}

// -------------------------------------------------------------------------
// Native DIB (BITMAPINFOHEADER) Image Builder
// -------------------------------------------------------------------------
function createDibImageBuffer(width, height, rgbaBuffer) {
  const xorSize = width * height * 4;
  const maskRowBytes = Math.ceil(width / 32) * 4; // 32-bit aligned 1-bit mask row
  const maskSize = maskRowBytes * height;
  const totalSize = 40 + xorSize + maskSize;

  const buf = Buffer.alloc(totalSize);

  // 1. BITMAPINFOHEADER (40 bytes)
  buf.writeUInt32LE(40, 0);               // biSize = 40
  buf.writeInt32LE(width, 4);             // biWidth
  buf.writeInt32LE(height * 2, 8);         // biHeight (x2 for XOR + AND mask)
  buf.writeUInt16LE(1, 12);               // biPlanes = 1
  buf.writeUInt16LE(32, 14);              // biBitCount = 32
  buf.writeUInt32LE(0, 16);               // biCompression = 0 (BI_RGB)
  buf.writeUInt32LE(xorSize, 20);         // biSizeImage
  buf.writeInt32LE(0, 24);                // biXPelsPerMeter
  buf.writeInt32LE(0, 28);                // biYPelsPerMeter
  buf.writeUInt32LE(0, 32);               // biClrUsed
  buf.writeUInt32LE(0, 36);               // biClrImportant

  // 2. XOR Pixel Buffer (Bottom-to-top 32-bit BGRA)
  let offset = 40;
  for (let y = height - 1; y >= 0; y--) {
    for (let x = 0; x < width; x++) {
      const srcIdx = (y * width + x) * 4;
      const r = rgbaBuffer[srcIdx];
      const g = rgbaBuffer[srcIdx + 1];
      const b = rgbaBuffer[srcIdx + 2];
      const a = rgbaBuffer[srcIdx + 3];

      buf[offset]     = b; // Blue
      buf[offset + 1] = g; // Green
      buf[offset + 2] = r; // Red
      buf[offset + 3] = a; // Alpha
      offset += 4;
    }
  }

  // 3. AND Mask Buffer (1-bit per pixel, 0x00 = fully visible via alpha channel)
  // Already initialized to 0x00 by Buffer.alloc

  return buf;
}

// -------------------------------------------------------------------------
// Standards-Compliant Multi-Resolution ICO Builder
// -------------------------------------------------------------------------
export function buildMultiResDibIco(images) {
  // images: Array of { width, height, rgbaBuffer }
  const count = images.length;
  const headerSize = 6 + count * 16;

  const dibBuffers = images.map(img => createDibImageBuffer(img.width, img.height, img.rgbaBuffer));

  let totalSize = headerSize;
  dibBuffers.forEach(buf => { totalSize += buf.length; });

  const icoBuf = Buffer.alloc(totalSize);

  // ICONDIR Header
  icoBuf.writeUInt16LE(0, 0);     // Reserved (must be 0)
  icoBuf.writeUInt16LE(1, 2);     // Resource Type (1 = Icon)
  icoBuf.writeUInt16LE(count, 4); // Number of Images

  let currentOffset = headerSize;

  // ICONDIRENTRY Structures
  for (let i = 0; i < count; i++) {
    const img = images[i];
    const dibBuf = dibBuffers[i];
    const dirOffset = 6 + i * 16;

    icoBuf.writeUInt8(img.width >= 256 ? 0 : img.width, dirOffset + 0);
    icoBuf.writeUInt8(img.height >= 256 ? 0 : img.height, dirOffset + 1);
    icoBuf.writeUInt8(0, dirOffset + 2);               // Color count (0 for 32-bit)
    icoBuf.writeUInt8(0, dirOffset + 3);               // Reserved
    icoBuf.writeUInt16LE(1, dirOffset + 4);            // Color Planes (1)
    icoBuf.writeUInt16LE(32, dirOffset + 6);           // Bits per Pixel (32)
    icoBuf.writeUInt32LE(dibBuf.length, dirOffset + 8); // Size of DIB payload
    icoBuf.writeUInt32LE(currentOffset, dirOffset + 12); // Offset to DIB payload

    dibBuf.copy(icoBuf, currentOffset);
    currentOffset += dibBuf.length;
  }

  return icoBuf;
}

// -------------------------------------------------------------------------
// Main Asset Generation Function
// -------------------------------------------------------------------------
export function generateAllIcons(rootDir = process.cwd()) {
  const assetsDir = path.join(rootDir, 'packaging/windows/assets');
  if (!fs.existsSync(assetsDir)) {
    fs.mkdirSync(assetsDir, { recursive: true });
  }

  console.log('Generating Standards-Compliant DIB Multi-Resolution Windows ICO files...');

  // 1. Generate Client App Icon
  const clientImages = SIZES.map(size => ({
    width: size,
    height: size,
    rgbaBuffer: renderAppIconCanvas(size)
  }));
  const clientIcoBuffer = buildMultiResDibIco(clientImages);
  const clientIcoPath = path.join(assetsDir, 'app-icon.ico');
  fs.writeFileSync(clientIcoPath, clientIcoBuffer);
  console.log(`  ✔ app-icon.ico regenerated (${(clientIcoBuffer.length / 1024).toFixed(1)} KB)`);

  // 2. Generate Key Generator Icon
  const keyGenImages = SIZES.map(size => ({
    width: size,
    height: size,
    rgbaBuffer: renderKeyGenIconCanvas(size)
  }));
  const keyGenIcoBuffer = buildMultiResDibIco(keyGenImages);
  const keyGenIcoPath = path.join(assetsDir, 'keygenerator-icon.ico');
  fs.writeFileSync(keyGenIcoPath, keyGenIcoBuffer);
  console.log(`  ✔ keygenerator-icon.ico regenerated (${(keyGenIcoBuffer.length / 1024).toFixed(1)} KB)`);

  return {
    clientIcoPath,
    keyGenIcoPath,
    clientSize: clientIcoBuffer.length,
    keyGenSize: keyGenIcoBuffer.length
  };
}

// Allow direct execution via CLI
if (process.argv[1] && process.argv[1].endsWith('generate-icons.js')) {
  generateAllIcons();
}
