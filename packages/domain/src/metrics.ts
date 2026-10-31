import type { WorkOrderState } from "./work-order.js";

export interface StateEvent {
  workOrderId: string;
  /** Estado em que a OS estava antes do evento (nulo na abertura). */
  fromState: WorkOrderState | null;
  toState: WorkOrderState;
  at: Date;
}

export interface StageDuration {
  state: WorkOrderState;
  /** Quantas passagens pela etapa terminaram no período. */
  samples: number;
  medianSeconds: number | null;
}

/** Mediana de uma lista (média dos dois centrais quando par). Vazia: nulo. */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const value = sorted.length % 2 === 1 ? sorted[mid] : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
  return value ?? null;
}

/**
 * Tempo por etapa (fórmula do dashboard): para cada PASSAGEM de uma OS por uma etapa, a duração é
 * (saída - entrada). Uma OS que passa duas vezes pela mesma etapa gera DUAS amostras (cada passagem
 * conta uma vez). Só entram passagens que TERMINARAM dentro de [from, to); a etapa em que a OS está
 * agora não entra (não terminou). Os eventos devem vir ordenados por OS e horário.
 */
export function computeStageDurations(events: readonly StateEvent[], from: Date, to: Date): StageDuration[] {
  const samples = new Map<WorkOrderState, number[]>();
  const entered = new Map<string, Map<WorkOrderState, Date>>();

  for (const event of events) {
    const perOrder = entered.get(event.workOrderId) ?? new Map<WorkOrderState, Date>();
    entered.set(event.workOrderId, perOrder);
    if (event.fromState) {
      const start = perOrder.get(event.fromState);
      if (start && event.at >= from && event.at < to) {
        const list = samples.get(event.fromState) ?? [];
        list.push((event.at.getTime() - start.getTime()) / 1000);
        samples.set(event.fromState, list);
      }
      perOrder.delete(event.fromState);
    }
    perOrder.set(event.toState, event.at);
  }

  return [...samples.entries()]
    .map(([state, values]) => ({ state, samples: values.length, medianSeconds: median(values) }))
    .sort((a, b) => a.state.localeCompare(b.state));
}

/** Estados que contam como OS "aberta" (ainda não entregue, encerrada ou cancelada). */
export const OPEN_STATES: readonly WorkOrderState[] = [
  "RECEBIDA", "EM_DIAGNOSTICO", "AGUARDANDO_APROVACAO", "AGUARDANDO_PECA", "EM_REPARO", "EM_TESTE", "PRONTA_RETIRADA", "PRONTA_RETIRADA_SEM_REPARO",
];
