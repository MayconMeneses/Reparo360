const grouping = new Intl.NumberFormat("pt-BR", { useGrouping: true, maximumFractionDigits: 0 });

/**
 * Formata centavos inteiros como "R$ 1.234,56". Sem divisão em ponto flutuante nos centavos,
 * e com espaço comum (não o U+00A0 do Intl) depois do "R$".
 */
export function formatBrl(cents: number): string {
  if (!Number.isSafeInteger(cents) || cents < 0) throw new RangeError("valor em centavos inválido");
  const reais = Math.trunc(cents / 100);
  const rest = String(cents % 100).padStart(2, "0");
  return `R$ ${grouping.format(reais)},${rest}`;
}
