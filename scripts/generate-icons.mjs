import sharp from "sharp";
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const publicDir = join(root, "public");
const iconsDir = join(publicDir, "icons");

mkdirSync(iconsDir, { recursive: true });

const svgBuffer = readFileSync(join(publicDir, "icon.svg"));
const render = (size) =>
  sharp(svgBuffer, { density: 72 * Math.max(1, size / 1024) })
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toBuffer();

const pngSizes = [16, 24, 32, 48, 64, 128, 256, 512, 1024];
const png = Object.fromEntries(
  await Promise.all(pngSizes.map(async (s) => [s, await render(s)])),
);

for (const size of pngSizes) {
  writeFileSync(join(iconsDir, `${size}x${size}.png`), png[size]);
}
writeFileSync(join(publicDir, "icon.png"), png[1024]);
writeFileSync(join(publicDir, "full-icon.png"), png[1024]);
writeFileSync(join(publicDir, "icon-mac.png"), png[512]);

writeFileSync(
  join(publicDir, "favicon.ico"),
  buildIco(
    [16, 32, 48].map((s) => png[s]),
    [16, 32, 48],
  ),
);
const winSizes = [16, 24, 32, 48, 64, 128, 256];
writeFileSync(
  join(publicDir, "icon.ico"),
  buildIco(
    winSizes.map((s) => png[s]),
    winSizes,
  ),
);
writeFileSync(
  join(publicDir, "icon.icns"),
  buildIcns([
    ["icp4", png[16]],
    ["icp5", png[32]],
    ["icp6", png[64]],
    ["ic07", png[128]],
    ["ic08", png[256]],
    ["ic09", png[512]],
    ["ic10", png[1024]],
    ["ic11", png[32]],
    ["ic12", png[64]],
    ["ic13", png[256]],
    ["ic14", png[512]],
  ]),
);
copyFileSync(join(publicDir, "icon.ico"), join(iconsDir, "icon.ico"));
copyFileSync(join(publicDir, "icon.icns"), join(iconsDir, "icon.icns"));

console.log("Icons generated from public/icon.svg");

function buildIco(pngBuffers, sizes) {
  const headerSize = 6;
  const dirEntrySize = 16;
  let offset = headerSize + pngBuffers.length * dirEntrySize;
  const entries = pngBuffers.map((buf, i) => {
    const entry = { size: sizes[i], buf, offset };
    offset += buf.length;
    return entry;
  });

  const ico = Buffer.alloc(offset);
  ico.writeUInt16LE(0, 0);
  ico.writeUInt16LE(1, 2);
  ico.writeUInt16LE(entries.length, 4);
  entries.forEach((e, i) => {
    const base = headerSize + i * dirEntrySize;
    ico.writeUInt8(e.size > 255 ? 0 : e.size, base);
    ico.writeUInt8(e.size > 255 ? 0 : e.size, base + 1);
    ico.writeUInt16LE(1, base + 4);
    ico.writeUInt16LE(32, base + 6);
    ico.writeUInt32LE(e.buf.length, base + 8);
    ico.writeUInt32LE(e.offset, base + 12);
    e.buf.copy(ico, e.offset);
  });
  return ico;
}

function buildIcns(chunks) {
  const parts = chunks.map(([type, data]) => {
    const head = Buffer.alloc(8);
    head.write(type, 0, "ascii");
    head.writeUInt32BE(data.length + 8, 4);
    return Buffer.concat([head, data]);
  });
  const body = Buffer.concat(parts);
  const head = Buffer.alloc(8);
  head.write("icns", 0, "ascii");
  head.writeUInt32BE(body.length + 8, 4);
  return Buffer.concat([head, body]);
}
