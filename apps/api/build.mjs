// Empacota a API. Dependências de terceiros ficam externas; os pacotes do
// workspace (@reparo360/*) são TypeScript e entram no bundle.
import { build } from "esbuild";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));
const external = Object.keys(pkg.dependencies).filter((name) => !name.startsWith("@reparo360/"));

await build({
  entryPoints: ["src/server.ts"],
  outfile: "dist/server.js",
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  sourcemap: true,
  external,
});
console.log("build da API concluído: apps/api/dist/server.js");
