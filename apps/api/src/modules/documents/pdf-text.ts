// As fontes padrão do PDF (Helvetica) usam WinAnsi (Windows-1252). Caracteres fora desse
// conjunto (emoji, alfabetos não latinos) não têm glifo; trocamos por "?" em vez de gerar
// lixo no documento. Decisão: não embutir fonte TTF no MVP (licença e tamanho); nomes em
// alfabeto não latino saem com "?" até haver necessidade real.
const WIN_ANSI_EXTRAS = new Set(
  "€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ".split(""),
);

export function toWinAnsi(text: string): string {
  let out = "";
  for (const char of text.normalize("NFC")) {
    const code = char.codePointAt(0) ?? 0;
    if (code === 0x0a || code === 0x09) out += char === "\n" ? "\n" : " ";
    else if (code < 0x20 || (code >= 0x7f && code < 0xa0)) out += "";
    else if (code <= 0xff || WIN_ANSI_EXTRAS.has(char)) out += char;
    else out += "?";
  }
  return out;
}
