import { describe, expect, it } from "vitest";
import { canManageMember, hasPermission, PERMISSIONS, requiresRecentAuth, TENANT_ROLES } from "./index.js";

describe("hasPermission", () => {
  it("proprietário possui todas as permissões", () => {
    for (const p of PERMISSIONS) expect(hasPermission("proprietario", p)).toBe(true);
  });

  it("atendente e técnico não possuem nenhuma permissão administrativa", () => {
    for (const role of ["atendente", "tecnico"] as const) {
      for (const p of PERMISSIONS) expect(hasPermission(role, p)).toBe(false);
    }
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
