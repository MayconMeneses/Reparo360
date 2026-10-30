import type { TenantRole } from "./roles.js";
import type { WorkOrderState } from "./work-order.js";

// Tabela de transições da OS. É a mesma de docs/product/FLUXOS.md (a ordem segue os números
// da matriz). Alterar uma exige alterar a outra no mesmo commit.
//
// mode:
//   direct  - ação disponível no endpoint genérico de transição
//   quote   - efeito colateral do ciclo do orçamento (enviar, aprovar, recusar, revisar, expirar)
//   delivery - registrada junto com o registro de entrega (endpoint próprio)
export type TransitionMode = "direct" | "quote" | "delivery";

export interface TransitionRule {
  readonly action: string;
  readonly from: readonly WorkOrderState[];
  readonly to: WorkOrderState;
  /** Papéis autorizados. Vazio = só o sistema (job). */
  readonly roles: readonly TenantRole[];
  readonly reasonRequired: boolean;
  readonly event: string;
  readonly mode: TransitionMode;
}

const T: TenantRole = "tecnico";
const G: TenantRole = "gerente";
const P: TenantRole = "proprietario";
const A: TenantRole = "atendente";

const rule = (r: TransitionRule): TransitionRule => r;

export const TRANSITION_RULES = [
  rule({ action: "iniciar_diagnostico", from: ["RECEBIDA"], to: "EM_DIAGNOSTICO", roles: [T, G, P], reasonRequired: false, event: "diagnostico_iniciado", mode: "direct" }),
  rule({ action: "cancelar", from: ["RECEBIDA", "EM_DIAGNOSTICO", "AGUARDANDO_PECA"], to: "CANCELADA", roles: [G, P], reasonRequired: true, event: "os_cancelada", mode: "direct" }),
  rule({ action: "enviar_orcamento", from: ["EM_DIAGNOSTICO"], to: "AGUARDANDO_APROVACAO", roles: [A, G, P], reasonRequired: false, event: "orcamento_enviado", mode: "quote" }),
  rule({ action: "liberar_sem_reparo", from: ["EM_DIAGNOSTICO"], to: "PRONTA_RETIRADA_SEM_REPARO", roles: [T, G, P], reasonRequired: true, event: "liberada_sem_reparo", mode: "direct" }),
  rule({ action: "aprovar_orcamento", from: ["AGUARDANDO_APROVACAO"], to: "EM_REPARO", roles: [A, G, P], reasonRequired: false, event: "orcamento_aprovado", mode: "quote" }),
  rule({ action: "aprovar_orcamento_aguardando_peca", from: ["AGUARDANDO_APROVACAO"], to: "AGUARDANDO_PECA", roles: [A, G, P], reasonRequired: false, event: "orcamento_aprovado", mode: "quote" }),
  rule({ action: "recusar_orcamento", from: ["AGUARDANDO_APROVACAO"], to: "PRONTA_RETIRADA_SEM_REPARO", roles: [A, G, P], reasonRequired: false, event: "orcamento_recusado", mode: "quote" }),
  rule({ action: "expirar_orcamento", from: ["AGUARDANDO_APROVACAO"], to: "PRONTA_RETIRADA_SEM_REPARO", roles: [], reasonRequired: false, event: "orcamento_expirado", mode: "quote" }),
  rule({ action: "revisar_orcamento", from: ["AGUARDANDO_APROVACAO"], to: "EM_DIAGNOSTICO", roles: [A, G, P], reasonRequired: false, event: "orcamento_revisado", mode: "quote" }),
  rule({ action: "peca_disponivel", from: ["AGUARDANDO_PECA"], to: "EM_REPARO", roles: [T, G, P], reasonRequired: false, event: "peca_recebida", mode: "direct" }),
  rule({ action: "liberar_sem_reparo_aguardando_peca", from: ["AGUARDANDO_PECA"], to: "PRONTA_RETIRADA_SEM_REPARO", roles: [G, P], reasonRequired: true, event: "liberada_sem_reparo", mode: "direct" }),
  rule({ action: "iniciar_testes", from: ["EM_REPARO"], to: "EM_TESTE", roles: [T, G, P], reasonRequired: false, event: "testes_iniciados", mode: "direct" }),
  rule({ action: "novo_defeito", from: ["EM_REPARO"], to: "EM_DIAGNOSTICO", roles: [T, G, P], reasonRequired: true, event: "novo_defeito_identificado", mode: "direct" }),
  rule({ action: "reprovar_testes", from: ["EM_TESTE"], to: "EM_REPARO", roles: [T, G, P], reasonRequired: true, event: "testes_reprovados", mode: "direct" }),
  rule({ action: "aprovar_testes", from: ["EM_TESTE"], to: "PRONTA_RETIRADA", roles: [T, G, P], reasonRequired: false, event: "testes_aprovados", mode: "direct" }),
  rule({ action: "entregar", from: ["PRONTA_RETIRADA", "PRONTA_RETIRADA_SEM_REPARO"], to: "ENTREGUE", roles: [A, G, P], reasonRequired: false, event: "entregue", mode: "delivery" }),
  rule({ action: "reabrir_bancada", from: ["PRONTA_RETIRADA"], to: "EM_REPARO", roles: [G, P], reasonRequired: true, event: "reaberta_bancada", mode: "direct" }),
  rule({ action: "reabrir_diagnostico", from: ["PRONTA_RETIRADA_SEM_REPARO"], to: "EM_DIAGNOSTICO", roles: [G, P], reasonRequired: true, event: "reaberta_diagnostico", mode: "direct" }),
  rule({ action: "encerrar", from: ["ENTREGUE"], to: "ENCERRADA", roles: [G, P], reasonRequired: false, event: "os_encerrada", mode: "direct" }),
] as const;

export type TransitionAction = (typeof TRANSITION_RULES)[number]["action"];

export const TRANSITION_ACTIONS = TRANSITION_RULES.map((r) => r.action) as [TransitionAction, ...TransitionAction[]];

export const DIRECT_ACTIONS = TRANSITION_RULES.filter((r) => r.mode === "direct").map((r) => r.action) as [
  TransitionAction,
  ...TransitionAction[],
];

const BY_ACTION = new Map<string, TransitionRule>(TRANSITION_RULES.map((r) => [r.action, r]));

export function ruleFor(action: string): TransitionRule | undefined {
  return BY_ACTION.get(action);
}

/** Estados dos quais nenhuma ação sai (exceto as listadas na tabela). */
export const TERMINAL_STATES: readonly WorkOrderState[] = ["ENCERRADA", "CANCELADA"];

/** OS que não aceita mais alterações de atribuição. */
export function isClosedForChanges(state: WorkOrderState): boolean {
  return state === "ENTREGUE" || state === "ENCERRADA" || state === "CANCELADA";
}
