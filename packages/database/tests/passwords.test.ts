import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openPools, type Pools } from "./helpers.js";

let pools: Pools;

beforeAll(async () => {
  pools = await openPools();
});
afterAll(async () => {
  await pools.app.end();
  await pools.migrator.end();
});

describe("isolamento dos tokens de senha no banco", () => {
  it("a aplicação não tem privilégio algum na tabela de tokens, e a RLS está ligada", async () => {
    const res = await pools.app.query(`
      SELECT c.relrowsecurity,
             has_table_privilege('reparo_app', c.oid, 'SELECT') OR has_table_privilege('reparo_app', c.oid, 'INSERT')
               OR has_table_privilege('reparo_app', c.oid, 'UPDATE') OR has_table_privilege('reparo_app', c.oid, 'DELETE') AS any_priv
      FROM pg_class c WHERE c.relname = 'password_tokens'`);
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].any_priv).toBe(false);
    expect(res.rows[0].relrowsecurity).toBe(true);
    await expect(pools.app.query("SELECT * FROM password_tokens")).rejects.toMatchObject({ code: "42501" });
  });

  it("toda função pw_* roda como dono, com caminho de busca fixo, e só a aplicação executa (nunca PUBLIC)", async () => {
    const res = await pools.app.query(`
      SELECT p.proname, p.prosecdef, p.proconfig, has_function_privilege('reparo_app', p.oid, 'EXECUTE') AS app_can,
             COALESCE(array_to_string(p.proacl, ','), '') AS acl
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname LIKE 'pw\\_%' ORDER BY p.proname`);
    expect(res.rows.map((r) => r.proname)).toEqual(["pw_token_consume", "pw_token_invite", "pw_token_issue"]);
    for (const row of res.rows) {
      expect(row.prosecdef, row.proname).toBe(true);
      expect((row.proconfig as string[] | null)?.some((c) => c.startsWith("search_path=")), row.proname).toBe(true);
      expect(String(row.acl).split(",").some((item) => item.startsWith("=")), row.proname).toBe(false);
      expect(row.app_can, row.proname).toBe(true);
    }
  });

  it("o tipo do token é limitado a redefinição ou convite", async () => {
    await expect(pools.migrator.query("INSERT INTO password_tokens (user_id, token_hash, purpose, expires_at) VALUES (gen_random_uuid(), 'x', 'qualquer', now())")).rejects.toMatchObject({ code: expect.stringMatching(/23514|23503/) });
  });
});
