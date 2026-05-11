import sharp from "sharp";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const publicDir = join(root, "public");
const iconsDir = join(publicDir, "icons");

mkdirSync(iconsDir, { recursive: true });

const svgBuffer = readFileSync(join(publicDir, "icon.svg"));

const pngSizes = [16, 24, 32, 48, 64, 128, 256, 512, 1024];

console.log("Generating PNG icons...");
await Promise.all(
  pngSizes.map((size) =>
    sharp(svgBuffer)
      .resize(size, size)
      .png()
      .toFile(join(iconsDir, `${size}x${size}.png`))
      .then(() => console.log(`  ✓ icons/${size}x${size}.png`)),
  ),
);

// icon.png (1024x1024) for Linux electron-builder
await sharp(svgBuffer)
  .resize(1024, 1024)
  .png()
  .toFile(join(publicDir, "icon.png"));
console.log("  ✓ icon.png");

// icon-mac.png (512x512) for macOS
await sharp(svgBuffer)
  .resize(512, 512)
  .png()
  .toFile(join(publicDir, "icon-mac.png"));
console.log("  ✓ icon-mac.png");

// full-icon.png (1024x1024) used in app UI
await sharp(svgBuffer)
  .resize(1024, 1024)
  .png()
  .toFile(join(publicDir, "full-icon.png"));
console.log("  ✓ full-icon.png");

// favicon.ico — embed 16, 32, 48 px layers
console.log("Generating favicon.ico...");
const icoSizes = [16, 32, 48];
const icoBuffers = await Promise.all(
  icoSizes.map((size) => sharp(svgBuffer).resize(size, size).png().toBuffer()),
);
writeFileSync(join(publicDir, "favicon.ico"), buildIco(icoBuffers, icoSizes));
console.log("  ✓ favicon.ico");

// icon.ico — embed 16, 32, 48, 64, 128, 256 px layers
console.log("Generating icon.ico...");
const winSizes = [16, 32, 48, 64, 128, 256];
const winBuffers = await Promise.all(
  winSizes.map((size) => sharp(svgBuffer).resize(size, size).png().toBuffer()),
);
writeFileSync(join(publicDir, "icon.ico"), buildIco(winBuffers, winSizes));
console.log("  ✓ icon.ico");

// icons/icon.ico and icons/icon.icns placeholders (stubs pointing to source)
// electron-builder generates .icns; copy the 1024 PNG as icons/icon.png for reference
await sharp(svgBuffer)
  .resize(1024, 1024)
  .png()
  .toFile(join(iconsDir, "icon.ico").replace("icon.ico", "1024x1024.png"));
// Copy icon.ico and icon.icns into icons/ as well
import { copyFileSync } from "fs";
copyFileSync(join(publicDir, "icon.ico"), join(iconsDir, "icon.ico"));
console.log("  ✓ icons/icon.ico");

console.log(
  "\nDone! Note: icon.icns requires macOS tools (iconutil). Use electron-builder on macOS to generate it.",
);

/**
 * Builds a minimal ICO file from PNG buffers.
 * @param {Buffer[]} pngBuffers
 * @param {number[]} sizes
 * @returns {Buffer}
 */
function buildIco(pngBuffers, sizes) {
  const count = pngBuffers.length;
  const headerSize = 6;
  const dirEntrySize = 16;
  const dirSize = headerSize + count * dirEntrySize;

  let offset = dirSize;
  const entries = pngBuffers.map((buf, i) => {
    const size = sizes[i];
    const entry = {
      size,
      width: size > 255 ? 0 : size,
      height: size > 255 ? 0 : size,
      buf,
      offset,
    };
    offset += buf.length;
    return entry;
  });

  const totalSize = offset;
  const ico = Buffer.alloc(totalSize);

  // ICO header
  ico.writeUInt16LE(0, 0); // reserved
  ico.writeUInt16LE(1, 2); // type: 1 = ICO
  ico.writeUInt16LE(count, 4); // image count

  // Directory entries
  entries.forEach((e, i) => {
    const base = headerSize + i * dirEntrySize;
    ico.writeUInt8(e.width, base); // width (0 = 256)
    ico.writeUInt8(e.height, base + 1); // height (0 = 256)
    ico.writeUInt8(0, base + 2); // color count
    ico.writeUInt8(0, base + 3); // reserved
    ico.writeUInt16LE(1, base + 4); // planes
    ico.writeUInt16LE(32, base + 6); // bit count
    ico.writeUInt32LE(e.buf.length, base + 8); // size of image data
    ico.writeUInt32LE(e.offset, base + 12); // offset of image data
  });

  // Image data
  entries.forEach((e) => e.buf.copy(ico, e.offset));

  return ico;
}
