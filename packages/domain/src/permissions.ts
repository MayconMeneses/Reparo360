import type { TenantRole } from "./roles.js";

/**
 * Permissões implementadas até a Fase 1. Novas permissões entram junto com o
 * módulo que as usa (ver docs/security/ACCESS_CONTROL_MATRIX.md).
 */
export const PERMISSIONS = [
  "team.manage",
  "tenant.settings.write",
  "audit.read",
  "data.export",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const GRANTS: Record<TenantRole, ReadonlySet<Permission>> = {
  proprietario: new Set<Permission>(PERMISSIONS),
  // Gerente: equipe com restrições (ver canAssignRole) e configuração operacional.
  gerente: new Set<Permission>(["team.manage", "tenant.settings.write", "audit.read"]),
  atendente: new Set<Permission>(),
  tecnico: new Set<Permission>(),
};

export function hasPermission(role: TenantRole, permission: Permission): boolean {
  return GRANTS[role].has(permission);
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
