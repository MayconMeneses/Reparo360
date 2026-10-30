/**
 * Extrai o texto de um PDF gerado pelo pdfkit com fontes padrão: cada string vem como
 * hexadecimal de bytes WinAnsi dentro de operadores TJ (verificado em sonda real).
 */
export function pdfText(pdf: Buffer): string {
  const raw = pdf.toString("latin1");
  let text = "";
  for (const match of raw.matchAll(/<([0-9a-f]+)>/gi)) text += Buffer.from(match[1] ?? "", "hex").toString("latin1");
  return text;
}
