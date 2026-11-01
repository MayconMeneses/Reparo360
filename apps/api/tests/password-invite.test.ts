import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { call, login, loginOk, onboard, PASSWORD, resetData, startTestEnv, type Account, type Session, type TestEnv } from "./helpers.js";
import { MemoryMailer, PUBLIC_URL, SECRET } from "./remote-helpers.js";

let env: TestEnv;
let mailer: MemoryMailer;
let now: Date;
let a: Account;
let owner: Session;
const logLines: string[] = [];
const NEW_PASSWORD = "senha-do-convidado-77";

beforeAll(async () => {
  mailer = new MemoryMailer();
  env = await startTestEnv({ LOG_LEVEL: "info", VERIFICATION_SECRET: SECRET, PUBLIC_URL, LOGIN_RATE_LIMIT_MAX: "1000" }, () => now, { write: (c: string) => void logLines.push(c) }, mailer);
});
afterAll(async () => {
  await env.close();
});
beforeEach(async () => {
  now = new Date("2026-11-12T12:00:00Z");
  logLines.length = 0;
  mailer.outbox.length = 0;
  mailer.failNext = false;
  await resetData(env.migrator);
  a = await onboard(env, "convA");
  owner = await loginOk(env, a.email);
});

const invite = (extra: object = {}) =>
  call(env, owner, "POST", "/team/members", { name: "Pessoa Convidada", email: "convidada@teste.invalid", role: "atendente", inviteByEmail: true, ...extra });
const confirm = (token: string, newPassword = NEW_PASSWORD) =>
  env.app.inject({ method: "POST", url: "/api/v1/auth/password-reset/confirm", payload: { token, newPassword } });
async function mailCount(n: number) {
  for (let i = 0; i < 100 && mailer.outbox.length < n; i++) await new Promise((r) => setTimeout(r, 20));
  return mailer.outbox.length;
}
const tokenOf = (text: string) => /#t=([A-Za-z0-9_-]{43})/.exec(text)?.[1] ?? "";

describe("convite de membro por e-mail", () => {
  it("cria a conta travada, manda o link SÓ por e-mail e nunca devolve o token na resposta", async () => {
    const res = await invite();
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ accepted: true });
    expect(await mailCount(1)).toBe(1);
    const mail = mailer.outbox[0]!;
    const token = tokenOf(mail.text);
    expect(mail.to).toBe("convidada@teste.invalid");
    expect(mail.text).toContain(`${PUBLIC_URL}/redefinir-senha#t=`);
    expect(res.body).not.toContain(token);
    expect(res.body).not.toMatch(/token|link|senha|password/i);
    const row = await env.migrator.query("SELECT must_change_password, password_hash FROM users WHERE email = 'convidada@teste.invalid'");
    expect(row.rows[0].must_change_password).toBe(true);
    expect(row.rows[0].password_hash).toMatch(/^\$argon2id\$/);
  });

  it("quem convida não consegue entrar como convidado: nenhuma senha conhecida abre a conta", async () => {
    await invite();
    for (const guess of [PASSWORD, "", "senha-aleatoria-qualquer-1", NEW_PASSWORD]) {
      expect((await login(env, "convidada@teste.invalid", undefined, guess || "x")).res.statusCode).toBe(401);
    }
  });

  it("a pessoa define a própria senha pelo link, entra com o papel certo e a conta destrava", async () => {
    await invite({ role: "tecnico" });
    await mailCount(1);
    expect((await confirm(tokenOf(mailer.outbox[0]!.text))).statusCode).toBe(204);
    const { res, session } = await login(env, "convidada@teste.invalid", undefined, NEW_PASSWORD);
    expect(res.statusCode).toBe(200);
    const me = await call(env, session!, "GET", "/me");
    expect(me.json()).toMatchObject({ role: "tecnico", senhaTemporaria: false });
    expect((await call(env, session!, "GET", "/work-orders/queue")).statusCode).toBe(200);
    expect((await call(env, session!, "GET", "/team")).statusCode).toBe(403); // continua só com o papel dado
  });

  it("senha E convite ao mesmo tempo, ou nenhum dos dois, são recusados (400)", async () => {
    expect((await invite({ password: "senha-qualquer-1234" })).statusCode).toBe(400);
    const neither = await call(env, owner, "POST", "/team/members", { name: "Sem Nada", email: "sem@teste.invalid", role: "atendente" });
    expect(neither.statusCode).toBe(400);
    expect((await invite({ inviteByEmail: false })).statusCode).toBe(400);
    const users = await env.migrator.query("SELECT count(*)::int AS n FROM users WHERE email IN ('convidada@teste.invalid','sem@teste.invalid')");
    expect(users.rows[0].n).toBe(0);
  });

  it("sem envio de e-mail configurado: 422 claro, nenhuma conta criada; o cadastro com senha continua funcionando", async () => {
    const off = await startTestEnv({}, () => now);
    try {
      const acc = await onboard(off, "convOff");
      const ownerOff = await loginOk(off, acc.email);
      const res = await call(off, ownerOff, "POST", "/team/members", { name: "Pessoa", email: "p@teste.invalid", role: "atendente", inviteByEmail: true });
      expect(res.statusCode).toBe(422);
      expect(res.json().error.code).toBe("ENVIO_INDISPONIVEL");
      const none = await off.migrator.query("SELECT count(*)::int AS n FROM users WHERE email = 'p@teste.invalid'");
      expect(none.rows[0].n).toBe(0);
      const withPassword = await call(off, ownerOff, "POST", "/team/members", { name: "Pessoa", email: "p@teste.invalid", role: "atendente", password: "senha-inicial-123" });
      expect(withPassword.statusCode).toBe(201);
    } finally {
      await off.close();
    }
  });

  it("e-mail que já tem conta: a resposta é IDÊNTICA à de e-mail novo, a pessoa recebe só um aviso (sem link) e não entra na equipe", async () => {
    const other = await onboard(env, "convB");
    const fresh = await invite({ email: "novinha@teste.invalid" });
    const existing = await invite({ email: other.email });
    expect(existing.statusCode).toBe(fresh.statusCode);
    expect(existing.body).toBe(fresh.body);
    expect(existing.headers["content-type"]).toBe(fresh.headers["content-type"]);
    await mailCount(2);
    await new Promise((r) => setTimeout(r, 200));
    const toExisting = mailer.outbox.filter((m) => m.to === other.email);
    expect(toExisting).toHaveLength(1);
    expect(toExisting[0]!.text).not.toMatch(/#t=|redefinir-senha|https?:\/\//); // aviso, nunca link
    expect(tokenOf(toExisting[0]!.text)).toBe("");
    const members = await call(env, owner, "GET", "/team");
    expect(members.json().members.map((m: { email: string }) => m.email).sort()).toEqual([a.email, "novinha@teste.invalid"].sort());
    const tokens = await env.migrator.query("SELECT count(*)::int AS n FROM password_tokens");
    expect(tokens.rows[0].n).toBe(1); // só o convite da pessoa nova
  });

  it("a auditoria do convite é igual com e sem conta existente (não revela quem já tem conta)", async () => {
    const other = await onboard(env, "convC");
    await invite({ email: "nova1@teste.invalid" });
    await invite({ email: other.email });
    const events = (await call(env, owner, "GET", "/audit?action=team_member_invited")).json().events as Array<{ targetType: string | null; targetId: string | null; outcome: string }>;
    expect(events).toHaveLength(2);
    expect(events.every((e) => e.targetId === null && e.targetType === "user" && e.outcome === "ok")).toBe(true);
  });

  it("limite de volume: 30 convites por hora por assistência (novos ou para e-mails existentes); depois a hora vira e libera", async () => {
    const other = await onboard(env, "convE");
    for (let i = 0; i < 30; i++) {
      const res = await invite({ email: i % 5 === 0 ? other.email : `lote${i}@teste.invalid` });
      expect(res.statusCode, `convite ${i + 1}`).toBe(202);
    }
    const over = await invite({ email: "excedente@teste.invalid" });
    expect(over.statusCode).toBe(429);
    expect(over.json().error.code).toBe("MUITOS_CONVITES");
    const none = await env.migrator.query("SELECT count(*)::int AS n FROM users WHERE email = 'excedente@teste.invalid'");
    expect(none.rows[0].n).toBe(0);
    now = new Date(now.getTime() + 61 * 60_000);
    expect((await invite({ email: "depois@teste.invalid" })).statusCode).toBe(202);
    // Os e-mails saem depois da resposta: espera todos (30 convites + 1) para não vazarem para o teste seguinte.
    expect(await mailCount(31)).toBe(31);
  }, 120_000);

  it("cadastro com senha inicial continua devolvendo 409 quando o e-mail existe (quem cadastra escolheu a senha)", async () => {
    const other = await onboard(env, "convD");
    const res = await call(env, owner, "POST", "/team/members", { name: "Fulana", email: other.email, password: "senha-inicial-123", role: "atendente" });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("EMAIL_JA_CADASTRADO");
    await new Promise((r) => setTimeout(r, 150));
    expect(mailer.outbox).toHaveLength(0);
  });

  it("o convite vale 72 horas e uma vez só", async () => {
    await invite();
    await mailCount(1);
    const token = tokenOf(mailer.outbox[0]!.text);
    now = new Date(now.getTime() + 73 * 3_600_000);
    expect((await confirm(token)).statusCode).toBe(400);
    mailer.outbox.length = 0;
    await invite({ email: "outra@teste.invalid" });
    await mailCount(1);
    const fresh = tokenOf(mailer.outbox[0]!.text);
    now = new Date(now.getTime() + 71 * 3_600_000);
    expect((await confirm(fresh)).statusCode).toBe(204);
    expect((await confirm(fresh)).statusCode).toBe(400);
  });

  it("o gerente não convida para cargo acima do dele (nenhum e-mail sai)", async () => {
    const created = await call(env, owner, "POST", "/team/members", { name: "Gerente Teste", email: "gerente-conv@teste.invalid", password: "senha-inicial-123", role: "gerente" });
    expect(created.statusCode).toBe(201);
    const manager = (await login(env, "gerente-conv@teste.invalid", undefined, "senha-inicial-123")).session!;
    const denied = await call(env, manager, "POST", "/team/members", { name: "Alto Cargo", email: "alto@teste.invalid", role: "proprietario", inviteByEmail: true });
    expect(denied.statusCode).toBe(403);
    await new Promise((r) => setTimeout(r, 200));
    expect(mailer.outbox).toHaveLength(0);
  });

  it("o banco só emite convite para conta recém-criada e travada, nunca para conta já em uso", async () => {
    const established = await env.pool.query("SELECT pw_token_invite($1::uuid, 'hash-x', now() + interval '1 day', now()) AS ok", [a.userId]);
    expect(established.rows[0].ok).toBe(false);
    const rows = await env.migrator.query("SELECT count(*)::int AS n FROM password_tokens");
    expect(rows.rows[0].n).toBe(0);
  });

  it("o convite aparece na auditoria da empresa sem o token, e token e senha não aparecem nos logs", async () => {
    await invite();
    await mailCount(1);
    const token = tokenOf(mailer.outbox[0]!.text);
    const audit = await call(env, owner, "GET", "/audit?action=team_member_invited");
    expect(audit.statusCode).toBe(200);
    expect(audit.json().events).toHaveLength(1);
    expect(audit.body).not.toContain(token);
    await confirm(token);
    const logs = logLines.join("");
    for (const secret of [token, NEW_PASSWORD, "convidada@teste.invalid"]) expect(logs).not.toContain(secret);
  });
});
