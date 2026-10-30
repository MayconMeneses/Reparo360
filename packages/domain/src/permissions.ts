import type { TenantRole } from "./roles.js";

/**
 * Permissões implementadas até a Fase 2. Novas permissões entram junto com o
 * módulo que as usa (ver docs/security/ACCESS_CONTROL_MATRIX.md).
 */
export const PERMISSIONS = [
  "team.manage",
  "tenant.settings.write",
  "audit.read",
  "data.export",
  "customer.create",
  "customer.update",
  "customer.read",
  "device.create",
  "device.update",
  "device.read",
  "work_order.create",
  "work_order.read",
  "work_order.assign",
  "intake.write",
  "attachment.upload",
  "attachment.read",
  "attachment.delete",
  "document.generate",
  "work_order.transition",
  "work_order.claim",
  "diagnostic.write",
  "quote.create",
  "quote.read",
  "quote.submit",
  "quote.manage",
  "quote.decision.in_person",
  "repair.update",
  "test_checklist.write",
  "delivery.register",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const FRONT_DESK: readonly Permission[] = [
  "customer.create",
  "customer.update",
  "customer.read",
  "device.create",
  "device.update",
  "device.read",
  "work_order.create",
  "work_order.read",
  "intake.write",
  "attachment.upload",
  "attachment.read",
  "document.generate",
  "delivery.register",
];

const QUOTING: readonly Permission[] = ["quote.create", "quote.read", "quote.submit", "quote.manage", "quote.decision.in_person"];

const GRANTS: Record<TenantRole, ReadonlySet<Permission>> = {
  proprietario: new Set<Permission>(PERMISSIONS),
  // Gerente: equipe com restrições (ver canManageMember) e configuração operacional.
  gerente: new Set<Permission>([
    "team.manage",
    "tenant.settings.write",
    "audit.read",
    ...FRONT_DESK,
    ...QUOTING,
    "work_order.assign",
    "work_order.transition",
    "diagnostic.write",
    "repair.update",
    "test_checklist.write",
    "attachment.delete",
  ]),
  // Atendente orça e registra a decisão presencial; não muda estados diretamente.
  atendente: new Set<Permission>([...FRONT_DESK, ...QUOTING]),
  // Técnico: só o que se liga a OS atribuídas (recorte feito no serviço). Orça apenas em rascunho (P-13):
  // enviar, revisar e decidir ficam com atendente/gerente/proprietário.
  tecnico: new Set<Permission>([
    "work_order.read",
    "work_order.transition",
    "work_order.claim",
    "diagnostic.write",
    "repair.update",
    "test_checklist.write",
    "quote.create",
    "quote.read",
    "attachment.upload",
    "attachment.read",
  ]),
};

export function hasPermission(role: TenantRole, permission: Permission): boolean {
  return GRANTS[role].has(permission);
}

/** Papéis que só enxergam as OS atribuídas a eles (e sem dados de contato do cliente). */
export function isRestrictedToAssigned(role: TenantRole): boolean {
  return role === "tecnico";
}

/** Permissões que exigem autenticação recente (reautenticação). */
const SENSITIVE: ReadonlySet<Permission> = new Set<Permission>(["team.manage", "data.export"]);

export function requiresRecentAuth(permission: Permission): boolean {
  return SENSITIVE.has(permission);
}

/**
 * O gerente não pode criar ou promover alguém a proprietário ou gerente,
 * nem alterar um proprietário (matriz de acesso, linha team.manage).
 */
export function canManageMember(actor: TenantRole, target: TenantRole, newRole?: TenantRole): boolean {
  if (!hasPermission(actor, "team.manage")) return false;
  if (actor === "proprietario") return true;
  const restricted: TenantRole[] = ["proprietario", "gerente"];
  if (restricted.includes(target)) return false;
  if (newRole && restricted.includes(newRole)) return false;
  return true;
}
