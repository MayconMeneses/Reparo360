import { schema, withContext } from "@reparo360/database";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { addMember, call, login, loginOk, onboard, PASSWORD, resetData, startTestEnv, type Account, type Session, type TestEnv } from "./helpers.js";

let env: TestEnv;
let a: Account;
let b: Account;
let ownerA: Session;
let ownerB: Session;

beforeAll(async () => {
  env = await startTestEnv();
});
afterAll(async () => {
  await env.close();
});
beforeEach(async () => {
  await resetData(env.migrator);
  a = await onboard(env, "assistenciaA");
  b = await onboard(env, "assistenciaB");
  ownerA = await loginOk(env, a.email);
  ownerB = await loginOk(env, b.email);
});

const listEmails = async (session: Session) => {
  const res = await call(env, session, "GET", "/team");
  return (res.json<{ members: Array<{ email: string }> }>().members).map((m) => m.email);
};

describe("isolamento entre Assistência A e B pela API", () => {
  it("cada proprietário lista apenas a própria equipe", async () => {
    expect(await listEmails(ownerA)).toEqual([a.email]);
    expect(await listEmails(ownerB)).toEqual([b.email]);
  });

  it("A não altera membro de B: 404, igual a um id inexistente", async () => {
    const cross = await call(env, ownerA, "PATCH", `/team/members/${b.userId}`, { status: "desativado" });
    expect(cross.statusCode).toBe(404);
    const missing = await call(env, ownerA, "PATCH", "/team/members/00000000-0000-4000-8000-000000000000", { status: "desativado" });
    expect(missing.statusCode).toBe(404);
    expect(cross.json()).toEqual(missing.json());
    expect((await call(env, ownerB, "GET", "/me")).statusCode).toBe(200);
  });

  it("tenantId enviado pelo cliente (cabeçalho, query ou corpo) não muda a empresa ativa", async () => {
    const viaQuery = await env.app.inject({
      method: "GET",
      url: `/api/v1/team?tenantId=${b.tenantId}`,
      headers: { cookie: ownerA.cookie, "x-tenant-id": b.tenantId },
    });
    expect(viaQuery.json<{ members: Array<{ email: string }> }>().members.map((m) => m.email)).toEqual([a.email]);

    const viaBody = await call(env, ownerA, "POST", "/team/members", {
      name: "Intruso",
      email: "intruso@teste.invalid",
      password: PASSWORD,
      role: "atendente",
      tenantId: b.tenantId,
    });
    expect(viaBody.statusCode).toBe(400);
    expect(await listEmails(ownerB)).toEqual([b.email]);
  });

  it("usuário de A e B entra em uma empresa por vez e nunca vê a outra", async () => {
    const shared = await addMember(env, ownerA, "atendente", "compartilhado");
    // Mesmo usuário passa a ser membro de B (inserção direta como seria um convite aceito).
    await withContext(env.migrator, { tenantId: b.tenantId }, (db) =>
      db.insert(schema.memberships).values({ tenantId: b.tenantId, userId: shared.userId, role: "tecnico" }));

    const ambiguous = await login(env, shared.email);
    expect(ambiguous.res.statusCode).toBe(409);
    expect(ambiguous.res.json().error.code).toBe("SELECAO_DE_EMPRESA_NECESSARIA");
    expect(ambiguous.res.json().error.details.tenants).toHaveLength(2);

    const inA = await loginOk(env, shared.email, a.tenantId);
    const me = (await call(env, inA, "GET", "/me")).json<{ tenant: { id: string }; role: string }>();
    expect(me.tenant.id).toBe(a.tenantId);
    expect(me.role).toBe("atendente");
  });

  it("login em empresa onde o usuário não é membro falha como credencial inválida", async () => {
    const res = await login(env, a.email, b.tenantId);
    expect(res.res.statusCode).toBe(401);
  });

  it("registro de auditoria fica na empresa de origem", async () => {
    await addMember(env, ownerA, "tecnico");
    const eventsA = await withContext(env.migrator, { tenantId: a.tenantId }, (db) => db.select().from(schema.auditEvents));
    const eventsB = await withContext(env.migrator, { tenantId: b.tenantId }, (db) => db.select().from(schema.auditEvents));
    expect(eventsA.some((e) => e.action === "team_member_created")).toBe(true);
    expect(eventsB.some((e) => e.action === "team_member_created")).toBe(false);
  });
});

describe("permissões no servidor", () => {
  it("atendente e técnico não acessam a gestão de equipe", async () => {
    for (const role of ["atendente", "tecnico"]) {
      const member = await addMember(env, ownerA, role);
      const session = await loginOk(env, member.email);
      expect((await call(env, session, "GET", "/team")).statusCode, role).toBe(403);
      const create = await call(env, session, "POST", "/team/members", { name: "X Y", email: "x@teste.invalid", password: PASSWORD, role: "atendente" });
      expect(create.statusCode, role).toBe(403);
    }
  });

  it("gerente gerencia atendente/técnico, mas não cria gerente ou proprietário", async () => {
    const manager = await addMember(env, ownerA, "gerente");
    const session = await loginOk(env, manager.email);
    expect((await call(env, session, "GET", "/team")).statusCode).toBe(200);
    const okRole = await call(env, session, "POST", "/team/members", { name: "Novo Técnico", email: `t-${Date.now()}@teste.invalid`, password: PASSWORD, role: "tecnico" });
    expect(okRole.statusCode).toBe(201);
    for (const role of ["gerente", "proprietario"]) {
      const denied = await call(env, session, "POST", "/team/members", { name: "Alto Cargo", email: `${role}-${Date.now()}@teste.invalid`, password: PASSWORD, role });
      expect(denied.statusCode, role).toBe(403);
    }
  });

  it("gerente não altera proprietário nem promove ninguém", async () => {
    const manager = await addMember(env, ownerA, "gerente");
    const clerk = await addMember(env, ownerA, "atendente");
    const session = await loginOk(env, manager.email);
    expect((await call(env, session, "PATCH", `/team/members/${a.userId}`, { status: "desativado" })).statusCode).toBe(403);
    expect((await call(env, session, "PATCH", `/team/members/${clerk.userId}`, { role: "gerente" })).statusCode).toBe(403);
    expect((await call(env, session, "PATCH", `/team/members/${clerk.userId}`, { role: "tecnico" })).statusCode).toBe(204);
  });

  it("ninguém altera o próprio vínculo", async () => {
    const res = await call(env, ownerA, "PATCH", `/team/members/${a.userId}`, { role: "atendente" });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("NAO_PODE_ALTERAR_A_SI_MESMO");
  });

  it("alterar o papel ou desativar encerra as sessões do alvo", async () => {
    const clerk = await addMember(env, ownerA, "atendente");
    const clerkSession = await loginOk(env, clerk.email);
    expect((await call(env, clerkSession, "GET", "/me")).statusCode).toBe(200);
    expect((await call(env, ownerA, "PATCH", `/team/members/${clerk.userId}`, { role: "tecnico" })).statusCode).toBe(204);
    expect((await call(env, clerkSession, "GET", "/me")).statusCode).toBe(401);
  });

  it("operação sensível exige autenticação recente e /auth/reauth a renova", async () => {
    await withContext(env.migrator, { tenantId: a.tenantId }, (db) =>
      db.update(schema.sessions).set({ lastAuthAt: new Date(Date.now() - 30 * 60_000) }));
    const stale = await call(env, ownerA, "GET", "/team");
    expect(stale.statusCode).toBe(403);
    expect(stale.json().error.code).toBe("REAUTENTICACAO_NECESSARIA");

    const wrong = await call(env, ownerA, "POST", "/auth/reauth", { password: "senha-errada-123456" });
    expect(wrong.statusCode).toBe(401);
    expect((await call(env, ownerA, "GET", "/team")).statusCode).toBe(403);

    expect((await call(env, ownerA, "POST", "/auth/reauth", { password: PASSWORD })).statusCode).toBe(204);
    expect((await call(env, ownerA, "GET", "/team")).statusCode).toBe(200);
  });

  it("dois proprietários não conseguem se rebaixar mutuamente e deixar a empresa sem dono", async () => {
    const second = await addMember(env, ownerA, "proprietario", "dono2");
    const ownerA2 = await loginOk(env, second.email);

    const [first, other] = await Promise.all([
      call(env, ownerA, "PATCH", `/team/members/${second.userId}`, { role: "atendente" }),
      call(env, ownerA2, "PATCH", `/team/members/${a.userId}`, { role: "atendente" }),
    ]);
    // Uma das chamadas pode falhar por 401 (sessão do alvo já revogada) ou 422 (último proprietário); ambas não podem passar.
    expect([first.statusCode, other.statusCode].filter((code) => code === 204).length).toBeLessThanOrEqual(1);

    const owners = await withContext(env.migrator, { tenantId: a.tenantId }, (db) =>
      db.select().from(schema.memberships));
    expect(owners.filter((m) => m.role === "proprietario" && m.status === "ativo").length).toBeGreaterThanOrEqual(1);
  });
});
