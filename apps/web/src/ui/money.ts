/**
 * Converte o que a pessoa digita ("1.234,56", "45,9", "150") em centavos inteiros.
 * Sem ponto flutuante: separa reais e centavos como texto. Valor inválido devolve null.
 */
export function parseMoneyToCents(input: string): number | null {
  const text = input.trim().replace(/^R\$\s*/, "");
  if (!/^\d{1,3}(\.\d{3})*(,\d{1,2})?$|^\d+(,\d{1,2})?$/.test(text)) return null;
  const [reais = "0", centavos = ""] = text.replaceAll(".", "").split(",");
  const cents = Number(reais) * 100 + Number(centavos.padEnd(2, "0"));
  return Number.isSafeInteger(cents) ? cents : null;
}

/** Centavos para o campo de edição ("231,80"), sem separador de milhar. */
export function centsToInput(cents: number): string {
  return `${Math.trunc(cents / 100)},${String(cents % 100).padStart(2, "0")}`;
}
