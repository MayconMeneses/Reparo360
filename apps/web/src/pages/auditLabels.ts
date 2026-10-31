// Rótulos em português das ações gravadas na auditoria. Ação desconhecida aparece com o código técnico (nunca some).
const LABELS: Record<string, string> = {
  login: "Entrada no sistema",
  logout: "Saída do sistema",
  reauth: "Confirmação de senha",
  password_changed: "Troca de senha",
  tenant_provisioned: "Assistência cadastrada",
  tenant_settings_updated: "Dados da assistência alterados",
  team_member_created: "Membro da equipe criado",
  team_member_updated: "Membro da equipe alterado",
  work_order_opened: "Ordem de serviço aberta",
  work_order_assigned: "Técnico atribuído",
  work_order_claimed: "Técnico assumiu a ordem",
  diagnostic_recorded: "Diagnóstico registrado",
  repair_recorded: "Reparo registrado",
  tests_recorded: "Testes registrados",
  delivery_registered: "Entrega registrada",
  attachment_uploaded: "Anexo enviado",
  attachment_downloaded: "Anexo baixado",
  attachment_deleted: "Anexo excluído",
  quote_submitted: "Orçamento enviado",
  quote_revised: "Orçamento revisado",
  quote_expired: "Orçamento vencido",
  quote_aprovado_presencial: "Orçamento aprovado (presencial)",
  quote_recusado_presencial: "Orçamento recusado (presencial)",
  quote_aprovado_remoto: "Orçamento aprovado pelo cliente (código por e-mail)",
  quote_recusado_remoto: "Orçamento recusado pelo cliente (código por e-mail)",
  customer_code_requested: "Cliente pediu código de confirmação",
  portal_link_created: "Link do cliente gerado",
  portal_link_revoked: "Link do cliente revogado",
  document_receipt_generated: "Comprovante de recebimento emitido",
  document_sheet_generated: "Ficha da ordem emitida",
  document_quote_generated: "Orçamento em PDF emitido",
  document_approval_generated: "Registro de decisão emitido",
  document_delivery_generated: "Comprovante de entrega emitido",
  master_tenant_created: "Assistência criada pela plataforma",
  master_tenant_suspensa: "Assistência suspensa pela plataforma",
  master_tenant_ativa: "Assistência reativada pela plataforma",
};

export function actionLabel(action: string): string {
  if (LABELS[action]) return LABELS[action];
  if (action.startsWith("work_order_")) return `Mudança na ordem (${action.slice("work_order_".length).replaceAll("_", " ")})`;
  return action;
}

export const ACTOR_LABEL: Record<string, string> = { plataforma: "Plataforma", cliente: "Cliente (portal)", sistema: "Sistema" };

export const ACTION_FILTER_OPTIONS = Object.entries(LABELS).map(([value, label]) => ({ value, label }));
