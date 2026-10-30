export const TENANT_ROLES = ["proprietario", "gerente", "atendente", "tecnico"] as const;
export type TenantRole = (typeof TENANT_ROLES)[number];

export const MEMBERSHIP_STATUSES = ["ativo", "desativado"] as const;
export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];

export const TENANT_STATUSES = ["em_configuracao", "em_teste", "ativa", "suspensa", "cancelada"] as const;
export type TenantStatus = (typeof TENANT_STATUSES)[number];

/** Estados em que a assistência pode operar normalmente. */
export function tenantCanOperate(status: TenantStatus): boolean {
  return status === "em_configuracao" || status === "em_teste" || status === "ativa";
}
