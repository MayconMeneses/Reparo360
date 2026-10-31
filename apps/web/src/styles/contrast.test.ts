// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("./tokens.css", import.meta.url), "utf8");

function block(selector: string): Record<string, string> {
  const start = css.indexOf(selector);
  if (start < 0) throw new Error(`bloco não encontrado: ${selector}`);
  const body = css.slice(css.indexOf("{", start) + 1, css.indexOf("}", start));
  return Object.fromEntries([...body.matchAll(/--([a-z-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)].map((m) => [m[1] ?? "", (m[2] ?? "").toLowerCase()]));
}

const light = block(":root {");
const dark = block(':root[data-theme="dark"]');
const darkMedia = block(':root:not([data-theme="light"])');

function luminance(hex: string): number {
  const channel = (offset: number) => {
    const c = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}
const ratio = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
};

const PAIRS: Array<[string, string]> = [
  ["text", "bg"], ["text", "surface"], ["muted", "bg"], ["muted", "surface"], ["primary", "surface"], ["primary", "bg"],
  ["on-primary", "primary"], ["danger", "surface"], ["danger", "bg"], ["success", "surface"], ["warn", "surface"],
];

describe("contraste dos tokens (WCAG 2.2 AA, texto normal >= 4,5:1)", () => {
  for (const [name, theme] of [["claro", light], ["escuro", dark]] as const) {
    it(`tema ${name}: todos os pares de texto/fundo atendem`, () => {
      for (const [fg, bg] of PAIRS) {
        const value = ratio(theme[fg] ?? "", theme[bg] ?? "");
        expect(value, `${fg} sobre ${bg} = ${value.toFixed(2)}`).toBeGreaterThanOrEqual(4.5);
      }
    });
  }

  it("o escuro automático (preferência do sistema) usa os mesmos valores do escuro escolhido", () => {
    for (const key of Object.keys(dark)) expect(darkMedia[key], key).toBe(dark[key]);
  });

  it("a borda de campos e botões (control-border) tem contraste de componente (>= 3:1) com a superfície e o fundo", () => {
    for (const theme of [light, dark]) {
      expect(ratio(theme["control-border"] ?? "", theme.surface ?? "")).toBeGreaterThanOrEqual(3);
      expect(ratio(theme["control-border"] ?? "", theme.bg ?? "")).toBeGreaterThanOrEqual(3);
    }
  });
});
