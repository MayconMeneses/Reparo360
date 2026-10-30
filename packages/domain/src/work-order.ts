export const WORK_ORDER_STATES = [
  "RECEBIDA",
  "EM_DIAGNOSTICO",
  "AGUARDANDO_APROVACAO",
  "AGUARDANDO_PECA",
  "EM_REPARO",
  "EM_TESTE",
  "PRONTA_RETIRADA",
  "PRONTA_RETIRADA_SEM_REPARO",
  "ENTREGUE",
  "ENCERRADA",
  "CANCELADA",
] as const;
export type WorkOrderState = (typeof WORK_ORDER_STATES)[number];

export const WORK_ORDER_PRIORITIES = ["baixa", "normal", "alta", "urgente"] as const;
export type WorkOrderPriority = (typeof WORK_ORDER_PRIORITIES)[number];

export const DEVICE_CATEGORIES = ["celular", "tablet", "notebook", "computador", "console", "outro"] as const;
export type DeviceCategory = (typeof DEVICE_CATEGORIES)[number];

/** "nao_testado" é o padrão: nunca marcar como funcionando o que não foi testado. */
export const CHECKLIST_RESULTS = ["funcionando", "com_defeito", "nao_testado", "nao_aplicavel"] as const;
export type ChecklistResult = (typeof CHECKLIST_RESULTS)[number];

export const ATTACHMENT_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"] as const;
export type AttachmentType = (typeof ATTACHMENT_TYPES)[number];
