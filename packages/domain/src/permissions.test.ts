import { describe, expect, it } from "vitest";
import { canManageMember, hasPermission, isRestrictedToAssigned, PERMISSIONS, requiresRecentAuth, TENANT_ROLES } from "./index.js";

describe("hasPermission", () => {
  it("proprietário possui todas as permissões", () => {
    for (const p of PERMISSIONS) expect(hasPermission("proprietario", p)).toBe(true);
  });

  it("atendente e técnico não possuem nenhuma permissão administrativa", () => {
    const admin = ["team.manage", "tenant.settings.write", "audit.read", "data.export"] as const;
    for (const role of ["atendente", "tecnico"] as const) {
      for (const p of admin) expect(hasPermission(role, p)).toBe(false);
    }
  });

  it("atendente opera o balcão, mas não atribui técnico depois nem apaga anexos", () => {
    expect(hasPermission("atendente", "work_order.create")).toBe(true);
    expect(hasPermission("atendente", "customer.create")).toBe(true);
    expect(hasPermission("atendente", "work_order.assign")).toBe(false);
    expect(hasPermission("atendente", "attachment.delete")).toBe(false);
  });

  it("técnico não acessa cadastro de clientes nem abre OS, e é restrito às atribuídas", () => {
    for (const p of ["customer.read", "customer.create", "device.read", "work_order.create", "attachment.delete"] as const) {
      expect(hasPermission("tecnico", p), p).toBe(false);
    }
    expect(hasPermission("tecnico", "work_order.read")).toBe(true);
    expect(isRestrictedToAssigned("tecnico")).toBe(true);
    expect(isRestrictedToAssigned("atendente")).toBe(false);
  });

  it("gerente atribui técnico e apaga anexos; exportar dados é só do proprietário", () => {
    expect(hasPermission("gerente", "work_order.assign")).toBe(true);
    expect(hasPermission("gerente", "attachment.delete")).toBe(true);
    expect(hasPermission("gerente", "data.export")).toBe(false);
  });

  it("gerente não exporta dados", () => {
    expect(hasPermission("gerente", "data.export")).toBe(false);
    expect(hasPermission("gerente", "team.manage")).toBe(true);
  });
});

describe("canManageMember", () => {
  it("gerente não altera proprietário nem outro gerente", () => {
    expect(canManageMember("gerente", "proprietario")).toBe(false);
    expect(canManageMember("gerente", "gerente")).toBe(false);
  });

  it("gerente não promove ninguém a gerente ou proprietário", () => {
    expect(canManageMember("gerente", "atendente", "gerente")).toBe(false);
    expect(canManageMember("gerente", "tecnico", "proprietario")).toBe(false);
  });

  it("gerente gerencia atendente e técnico", () => {
    expect(canManageMember("gerente", "atendente", "tecnico")).toBe(true);
  });

  it("papéis sem team.manage nunca gerenciam", () => {
    for (const target of TENANT_ROLES) {
      expect(canManageMember("atendente", target)).toBe(false);
      expect(canManageMember("tecnico", target)).toBe(false);
    }
  });
});

describe("requiresRecentAuth", () => {
  it("gestão de equipe e exportação exigem reautenticação", () => {
    expect(requiresRecentAuth("team.manage")).toBe(true);
    expect(requiresRecentAuth("data.export")).toBe(true);
    expect(requiresRecentAuth("audit.read")).toBe(false);
  });
});
