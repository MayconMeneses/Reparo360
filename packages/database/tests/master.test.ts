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

describe("isolamento do Master no banco", () => {
  it("a aplicação não tem nenhum privilégio direto sobre as tabelas do Master, e a RLS está ligada", async () => {
    const res = await pools.app.query(`
      SELECT c.relname, c.relrowsecurity,
             has_table_privilege('reparo_app', c.oid, 'SELECT') OR has_table_privilege('reparo_app', c.oid, 'INSERT')
               OR has_table_privilege('reparo_app', c.oid, 'UPDATE') OR has_table_privilege('reparo_app', c.oid, 'DELETE') AS any_priv
      FROM pg_class c WHERE c.relname IN ('platform_admins', 'platform_challenges', 'platform_sessions') ORDER BY c.relname`);
    expect(res.rows.map((r) => r.relname)).toEqual(["platform_admins", "platform_challenges", "platform_sessions"]);
    for (const row of res.rows) {
      expect(row.any_priv, row.relname).toBe(false);
      expect(row.relrowsecurity, row.relname).toBe(true);
    }
  });

  it("toda função master_* roda como dono, tem caminho de busca fixo e só a aplicação pode executar (nunca PUBLIC)", async () => {
    const res = await pools.app.query(`
      SELECT p.proname, p.prosecdef, p.proconfig, has_function_privilege('reparo_app', p.oid, 'EXECUTE') AS app_can,
             COALESCE(array_to_string(p.proacl, ','), '') AS acl
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname LIKE 'master\\_%' ORDER BY p.proname`);
    expect(res.rows.length).toBeGreaterThanOrEqual(12);
    for (const row of res.rows) {
      expect(row.prosecdef, row.proname).toBe(true);
      expect((row.proconfig as string[] | null)?.some((c) => c.startsWith("search_path=")), row.proname).toBe(true);
      // "=X/..." no início de um item da ACL significaria EXECUTE para PUBLIC.
      expect(String(row.acl).split(",").some((item) => item.startsWith("=")), row.proname).toBe(false);
      // master_session_admin é interna: só chamada por outras funções, nunca pela aplicação.
      expect(row.app_can, row.proname).toBe(row.proname !== "master_session_admin");
    }
  });

  it("só a tabela de empresas ganhou política ligada ao marcador do Master (nenhuma tabela de cliente)", async () => {
    const res = await pools.app.query(`SELECT tablename, policyname FROM pg_policies WHERE qual LIKE '%master_op%' OR with_check LIKE '%master_op%' ORDER BY policyname`);
    expect(res.rows).toEqual([
      { tablename: "tenants", policyname: "tenants_master_read" },
      { tablename: "tenants", policyname: "tenants_master_update" },
    ]);
  });

  it("sem o marcador, a aplicação sem contexto de empresa não enxerga nenhuma empresa", async () => {
    const res = await pools.app.query("SELECT count(*)::int AS n FROM tenants");
    expect(res.rows[0].n).toBe(0);
  });
});
