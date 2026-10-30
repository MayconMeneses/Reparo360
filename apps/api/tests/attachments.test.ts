import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  addMember, call, JPEG, loginOk, onboard, PNG, resetData, setupOrder, startTestEnv, upload,
  type Account, type Session, type TestEnv,
} from "./helpers.js";

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
  a = await onboard(env, "anexosA");
  b = await onboard(env, "anexosB");
  ownerA = await loginOk(env, a.email);
  ownerB = await loginOk(env, b.email);
});

const tenantFiles = (tenantId: string) => {
  const dir = join(env.storageDir, tenantId);
  return existsSync(dir) ? readdirSync(dir) : [];
};

describe("upload e download", () => {
  it("guarda o arquivo com nome gerado pelo servidor e devolve com cabeçalhos seguros", async () => {
    const { orderId } = await setupOrder(env, ownerA);
    const res = await upload(env, ownerA, orderId, "image/jpeg", JPEG);
    expect(res.statusCode).toBe(201);
    const { id } = res.json<{ id: string }>();

    const files = tenantFiles(a.tenantId);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^[0-9a-f-]{36}$/);
    expect(readFileSync(join(env.storageDir, a.tenantId, files[0] ?? "")).equals(JPEG)).toBe(true);

    const download = await call(env, ownerA, "GET", `/attachments/${id}`);
    expect(download.statusCode).toBe(200);
    expect(download.rawPayload.equals(JPEG)).toBe(true);
    expect(download.headers["content-type"]).toBe("image/jpeg");
    expect(download.headers["content-disposition"]).toBe("attachment");
    expect(download.headers["x-content-type-options"]).toBe("nosniff");
    expect(download.headers["cache-control"]).toBe("no-store");

    const detail = (await call(env, ownerA, "GET", `/work-orders/${orderId}`)).json();
    expect(detail.attachments).toHaveLength(1);
    expect(detail.events.map((e: { type: string }) => e.type)).toEqual(["os_aberta", "anexo_adicionado"]);
  });

  it("recusa conteúdo que não bate com o tipo declarado, tipos fora da lista e SVG/HTML", async () => {
    const { orderId } = await setupOrder(env, ownerA);
    const mismatch = await upload(env, ownerA, orderId, "image/jpeg", PNG);
    expect(mismatch.statusCode).toBe(415);
    expect(mismatch.json().error.code).toBe("CONTEUDO_DIVERGENTE");

    const html = await upload(env, ownerA, orderId, "image/png", Buffer.from("<html><script>alert(1)</script></html>"));
    expect(html.statusCode).toBe(415);
    expect(html.json().error.code).toBe("TIPO_NAO_SUPORTADO");

    const svg = await upload(env, ownerA, orderId, "image/svg+xml", Buffer.from("<svg onload=alert(1)></svg>"));
    expect(svg.statusCode).toBe(415);
    expect((await upload(env, ownerA, orderId, "application/x-msdownload", Buffer.from("MZ"))).statusCode).toBe(415);
    expect(tenantFiles(a.tenantId)).toHaveLength(0);
  });

  it("arquivo vazio e arquivo acima de 8 MB são recusados sem gravar nada", async () => {
    const { orderId } = await setupOrder(env, ownerA);
    const empty = await upload(env, ownerA, orderId, "image/png", Buffer.alloc(0));
    expect(empty.statusCode).toBeGreaterThanOrEqual(400);
    expect(empty.statusCode).toBeLessThan(500);
    const huge = Buffer.concat([JPEG, Buffer.alloc(8 * 1024 * 1024)]);
    const big = await upload(env, ownerA, orderId, "image/jpeg", huge);
    expect(big.statusCode).toBe(413);
    expect(tenantFiles(a.tenantId)).toHaveLength(0);
  });

  it("sem sessão: 401; sem token CSRF: 403", async () => {
    const { orderId } = await setupOrder(env, ownerA);
    const anonymous = await env.app.inject({
      method: "POST", url: `/api/v1/work-orders/${orderId}/attachments`, headers: { "content-type": "image/jpeg" }, payload: JPEG,
    });
    expect(anonymous.statusCode).toBe(401);
    const noCsrf = await env.app.inject({
      method: "POST", url: `/api/v1/work-orders/${orderId}/attachments`,
      headers: { cookie: ownerA.cookie, "content-type": "image/jpeg" }, payload: JPEG,
    });
    expect(noCsrf.statusCode).toBe(403);
  });

  it("limita a 20 anexos por OS, inclusive em uploads simultâneos", async () => {
    const { orderId } = await setupOrder(env, ownerA);
    const first = await Promise.all(Array.from({ length: 12 }, () => upload(env, ownerA, orderId, "image/png", PNG)));
    const second = await Promise.all(Array.from({ length: 12 }, () => upload(env, ownerA, orderId, "image/png", PNG)));
    const codes = [...first, ...second].map((r) => r.statusCode);
    expect(codes.filter((c) => c === 201)).toHaveLength(20);
    expect(codes.filter((c) => c === 409)).toHaveLength(4);
    expect(tenantFiles(a.tenantId)).toHaveLength(20);
  });
});

describe("acesso a anexos", () => {
  it("B não baixa, nem envia anexo para a OS de A; a resposta é igual à de id inexistente", async () => {
    const { orderId } = await setupOrder(env, ownerA);
    const { id } = (await upload(env, ownerA, orderId, "image/jpeg", JPEG)).json<{ id: string }>();
    const cross = await call(env, ownerB, "GET", `/attachments/${id}`);
    const missing = await call(env, ownerB, "GET", "/attachments/00000000-0000-4000-8000-000000000000");
    expect(cross.statusCode).toBe(404);
    expect(cross.json()).toEqual(missing.json());
    expect((await upload(env, ownerB, orderId, "image/jpeg", JPEG)).statusCode).toBe(404);
    // B é proprietário na própria empresa (tem attachment.delete), mas o anexo é de A: 404.
    expect((await call(env, ownerB, "DELETE", `/attachments/${id}`)).statusCode).toBe(404);
    expect((await call(env, ownerA, "GET", `/attachments/${id}`)).statusCode).toBe(200);
  });

  it("técnico atribuído envia e baixa; técnico de OS não atribuída recebe 404", async () => {
    const tech = await addMember(env, ownerA, "tecnico");
    const techSession = await loginOk(env, tech.email);
    const mine = await setupOrder(env, ownerA, { technicianId: tech.userId });
    const notMine = await setupOrder(env, ownerA);

    const sent = await upload(env, techSession, mine.orderId, "image/png", PNG);
    expect(sent.statusCode).toBe(201);
    const got = await call(env, techSession, "GET", `/attachments/${sent.json().id}`);
    expect(got.statusCode).toBe(200);

    expect((await upload(env, techSession, notMine.orderId, "image/png", PNG)).statusCode).toBe(404);
    const owned = (await upload(env, ownerA, notMine.orderId, "image/png", PNG)).json<{ id: string }>().id;
    expect((await call(env, techSession, "GET", `/attachments/${owned}`)).statusCode).toBe(404);
  });
});

describe("exclusão lógica", () => {
  it("só gerente/proprietário exclui; some das listagens e do download, mas o arquivo é preservado", async () => {
    const clerk = await loginOk(env, (await addMember(env, ownerA, "atendente")).email);
    const manager = await loginOk(env, (await addMember(env, ownerA, "gerente")).email);
    const { orderId } = await setupOrder(env, ownerA);
    const { id } = (await upload(env, clerk, orderId, "image/jpeg", JPEG)).json<{ id: string }>();

    expect((await call(env, clerk, "DELETE", `/attachments/${id}`)).statusCode).toBe(403);
    expect((await call(env, manager, "DELETE", `/attachments/${id}`)).statusCode).toBe(204);
    expect((await call(env, manager, "DELETE", `/attachments/${id}`)).statusCode).toBe(404);
    expect((await call(env, ownerA, "GET", `/attachments/${id}`)).statusCode).toBe(404);

    const detail = (await call(env, ownerA, "GET", `/work-orders/${orderId}`)).json();
    expect(detail.attachments).toHaveLength(0);
    expect(detail.events.map((e: { type: string }) => e.type)).toEqual(["os_aberta", "anexo_adicionado", "anexo_removido"]);
    expect(tenantFiles(a.tenantId)).toHaveLength(1);
  });
});
