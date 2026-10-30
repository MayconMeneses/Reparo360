export const TEST_RESULTS = ["aprovado", "reprovado", "nao_testado", "nao_aplicavel"] as const;
export type TestResult = (typeof TEST_RESULTS)[number];

export const REPAIR_OUTCOMES = ["concluido", "parcial", "sem_sucesso"] as const;
export type RepairOutcome = (typeof REPAIR_OUTCOMES)[number];

/**
 * P-28 (proposta, a validar com assistências reais): como o atendente confirmou quem retirou.
 * Não se coleta número de documento (spec 11.5).
 */
export const DELIVERY_CONFIRMATIONS = ["comprovante_apresentado", "documento_conferido", "outro"] as const;
export type DeliveryConfirmation = (typeof DELIVERY_CONFIRMATIONS)[number];

export interface TestRoundEvaluation {
  /** RN-052: pode liberar para retirada. */
  approvable: boolean;
  /** Há ao menos um item reprovado: a OS deve voltar à bancada. */
  hasFailure: boolean;
  reasons: string[];
}

/**
 * Avalia a última rodada de testes do ciclo atual. Aprovar exige ao menos um item aprovado,
 * nenhum reprovado e nenhum "não testado" (o que não se aplica é marcado como tal).
 * Rodada vazia ou só de "não se aplica" nunca aprova.
 */
export function evaluateTestRound(results: readonly TestResult[]): TestRoundEvaluation {
  const reasons: string[] = [];
  if (results.length === 0) reasons.push("nenhum teste registrado");
  if (results.includes("reprovado")) reasons.push("há item reprovado");
  if (results.includes("nao_testado")) reasons.push("há item não testado");
  if (results.length > 0 && !results.includes("aprovado")) reasons.push("nenhum item aprovado");
  return { approvable: reasons.length === 0, hasFailure: results.includes("reprovado"), reasons };
}

/** Compara acessórios devolvidos com os do recebimento, ignorando caixa e espaços. */
export function accessoriesDiffer(received: readonly string[], returned: readonly string[]): boolean {
  const norm = (list: readonly string[]) => [...new Set(list.map((item) => item.trim().toLowerCase()))].sort();
  const a = norm(received);
  const b = norm(returned);
  return a.length !== b.length || a.some((item, index) => item !== b[index]);
}
