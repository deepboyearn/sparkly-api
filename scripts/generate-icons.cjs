const fs = require("node:fs/promises");
const path = require("node:path");
const pngToIcoModule = require("png-to-ico");
const sharp = require("sharp");
const pngToIco = pngToIcoModule.default ?? pngToIcoModule;

async function main() {
  const rootDir = path.resolve(__dirname, "..");
  const sourcePng = path.join(rootDir, "src", "logo", "logp.png");
  const squarePng = path.join(rootDir, "src", "logo", "logp-square.png");
  const targetIco = path.join(rootDir, "src", "logo", "logp.ico");
  const metadata = await sharp(sourcePng).metadata();
  const side = Math.max(metadata.width ?? 0, metadata.height ?? 0, 256);

  await sharp(sourcePng)
    .resize(side, side, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toFile(squarePng);

  const icoBuffer = await pngToIco(squarePng);
  await fs.writeFile(targetIco, icoBuffer);
  process.stdout.write(`Generated ${targetIco}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
