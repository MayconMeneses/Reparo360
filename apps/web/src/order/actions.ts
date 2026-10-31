import { TRANSITION_RULES, type TenantRole, type TransitionRule } from "@reparo360/domain";

/**
 * Ações DIRETAS que o papel enxerga no estado atual. É só apresentação, espelhando a tabela do domínio:
 * esconder um botão não é controle de acesso, o servidor valida estado, papel e pré-condições de novo.
 */
export function availableActions(state: string, role: TenantRole, context: { hasTechnician: boolean }): TransitionRule[] {
  return TRANSITION_RULES.filter(
    (rule) =>
      rule.mode === "direct" &&
      (rule.from as readonly string[]).includes(state) &&
      (rule.roles as readonly TenantRole[]).includes(role) &&
      // iniciar o diagnóstico exige técnico atribuído; sem ele o botão só confundiria.
      !(rule.action === "iniciar_diagnostico" && !context.hasTechnician),
  );
}

export const ACTION_LABEL: Record<string, string> = {
  iniciar_diagnostico: "Iniciar diagnóstico",
  cancelar: "Cancelar OS",
  liberar_sem_reparo: "Liberar sem reparo",
  liberar_sem_reparo_aguardando_peca: "Liberar sem reparo",
  peca_disponivel: "Peça chegou: voltar ao reparo",
  novo_defeito: "Registrar novo defeito",
  iniciar_testes: "Iniciar testes finais",
  reprovar_testes: "Reprovar testes (voltar ao reparo)",
  aprovar_testes: "Aprovar testes e liberar para retirada",
  reabrir_bancada: "Reabrir a bancada",
  reabrir_diagnostico: "Reabrir o diagnóstico",
  encerrar: "Encerrar OS",
};

/** Ações destrutivas ou de difícil reversão ganham confirmação. */
export const NEEDS_CONFIRMATION = new Set(["cancelar", "encerrar", "liberar_sem_reparo", "liberar_sem_reparo_aguardando_peca"]);

export const EVENT_LABEL: Record<string, string> = {
  os_aberta: "OS aberta", tecnico_atribuido: "Técnico atribuído", tecnico_removido: "Técnico removido", os_assumida: "OS assumida pelo técnico",
  diagnostico_iniciado: "Diagnóstico iniciado", diagnostico_registrado: "Diagnóstico registrado", orcamento_criado: "Orçamento criado",
  orcamento_enviado: "Orçamento enviado", orcamento_aprovado: "Orçamento aprovado", orcamento_recusado: "Orçamento recusado",
  orcamento_expirado: "Orçamento expirado", orcamento_revisado: "Orçamento revisado", reparo_registrado: "Reparo registrado",
  testes_iniciados: "Testes iniciados", testes_registrados: "Testes registrados", testes_aprovados: "Testes aprovados: pronta para retirada",
  testes_reprovados: "Testes reprovados", liberada_sem_reparo: "Liberada sem reparo", peca_recebida: "Peça recebida",
  novo_defeito_identificado: "Novo defeito identificado", reaberta_bancada: "Bancada reaberta", reaberta_diagnostico: "Diagnóstico reaberto",
  entregue: "Equipamento entregue", os_encerrada: "OS encerrada", os_cancelada: "OS cancelada", anexo_adicionado: "Anexo adicionado", anexo_removido: "Anexo removido",
};
