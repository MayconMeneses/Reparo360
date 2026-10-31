// Gera os ícones do app (PNG) sem dependências: fundo azul da marca com um anel e um ponto centrais.
// Uso: node scripts/generate-icons.mjs  (grava em apps/web/public/icons)
import { mkdirSync, writeFileSync } from "node:fs";
import { crc32, deflateSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const out = join(fileURLToPath(new URL("..", import.meta.url)), "apps", "web", "public", "icons");
mkdirSync(out, { recursive: true });

const BG = [0x12, 0x50, 0xc8, 0xff];
const FG = [0xff, 0xff, 0xff, 0xff];

function png(size, safe) {
  // `safe` = fração do lado ocupada pelo desenho (o ícone "maskable" precisa ficar dentro de 80%).
  const rows = [];
  const c = (size - 1) / 2;
  const ringOuter = (size * safe) / 2;
  const ringInner = ringOuter * 0.72;
  const dot = ringOuter * 0.3;
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 4);
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - c, y - c);
      const on = (d <= ringOuter && d >= ringInner) || d <= dot;
      row.set(on ? FG : BG, 1 + x * 4);
    }
    rows.push(row);
  }
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 6, 0, 0, 0], 8); // 8 bits, RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.concat(rows))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const files = { "icon-32.png": [32, 0.82], "apple-touch-icon.png": [180, 0.82], "icon-192.png": [192, 0.82], "icon-512.png": [512, 0.82], "maskable-512.png": [512, 0.6] };
for (const [name, [size, safe]] of Object.entries(files)) {
  writeFileSync(join(out, name), png(size, safe));
  console.log(`gerado ${name} (${size}x${size})`);
}
