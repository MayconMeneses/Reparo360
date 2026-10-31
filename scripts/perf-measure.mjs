/* global fetch, setTimeout */
// Medição de desempenho com volume SINTÉTICO, no banco de TESTE (nunca no de uso real):
//   node scripts/perf-measure.mjs [--customers 20000] [--orders 30000] [--runs 60]
// Sobe a API compilada (apps/api/dist), cria uma empresa de teste, popula o banco com dados fictícios por SQL,
// mede p50/p95 de endpoints reais e mostra o plano (EXPLAIN ANALYZE) das buscas. No fim limpa o banco de teste.
// Resultado vale para ESTA máquina, este volume e um único cliente; não é promessa de capacidade.
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compose, loadEnv, parseArgs, psql, root } from "./lib/backup-common.mjs";

const args = parseArgs(process.argv.slice(2));
const CUSTOMERS = Number(args.customers ?? 20000);
const ORDERS = Number(args.orders ?? 30000);
const RUNS = Number(args.runs ?? 60);
// Horas em que as OS ficam espalhadas para trás. 720 (30 dias) = pior caso do dashboard; 17000 (~2 anos) = empresa madura.
const SPREAD = Number(args["spread-hours"] ?? 720);
const PORT = 3998;
const DB = "reparo360_test";
const base = `http://127.0.0.1:${PORT}`;
const env = loadEnv();
if (!env.TEST_DATABASE_URL) { console.error("TEST_DATABASE_URL não definida no .env"); process.exit(2); }

const serverEnv = { ...process.env, ...env, DATABASE_URL: env.TEST_DATABASE_URL, PORT: String(PORT), HOST: "127.0.0.1", ALLOW_PUBLIC_ONBOARDING: "true", LOG_LEVEL: "silent", STORAGE_DIR: mkdtempSync(join(tmpdir(), "r360-perf-")), LOGIN_RATE_LIMIT_MAX: "1000" };
delete serverEnv.WEB_DIST; // só a API é medida
delete serverEnv.MASTER_ENC_KEY;
const server = spawn("node", ["apps/api/dist/server.js"], { cwd: root, env: serverEnv, stdio: "ignore" });
const cleanup = () => { try { server.kill(); } catch { /* já encerrou */ } };
process.on("exit", cleanup);

async function until(fn, ms) { const end = Date.now() + ms; while (Date.now() < end) { try { if (await fn()) return true; } catch { /* tenta de novo */ } await new Promise((r) => setTimeout(r, 300)); } return false; }
if (!(await until(async () => (await fetch(`${base}/health`)).ok, 20000))) { console.error("a API não subiu (rode pnpm build antes)"); process.exit(2); }

const post = (path, body, cookie) => fetch(base + path, { method: "POST", headers: { "content-type": "application/json", origin: base, ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
const email = `perf-${Date.now()}@teste.invalid`;
const created = await post("/api/v1/tenants", { tenantName: "Empresa de medição", ownerName: "Dono Perf", ownerEmail: email, ownerPassword: "senha-perf-sintetica-123" });
const { tenant, owner } = await created.json();
const login = await post("/api/v1/auth/login", { email, password: "senha-perf-sintetica-123" });
const cookie = login.headers.getSetCookie().find((c) => c.startsWith("__Host-r360_session=")).split(";")[0];

// ---- população sintética (como superusuário, só neste banco de teste) ----
const t0 = Date.now();
const sql = `
INSERT INTO customers (id, tenant_id, name, phone, created_at)
SELECT gen_random_uuid(), '${tenant.id}', 'Cliente ' || i || (ARRAY['Silva','Souza','Oliveira','Santos','Lima'])[1 + i % 5],
       '85' || lpad((900000000 + i)::text, 9, '0'), now() - (i % 900) * interval '1 hour'
FROM generate_series(1, ${CUSTOMERS}) i;
CREATE TEMP TABLE c AS SELECT id, row_number() OVER (ORDER BY created_at, id) AS n FROM customers WHERE tenant_id = '${tenant.id}';
INSERT INTO devices (id, tenant_id, customer_id, category, brand, model)
SELECT gen_random_uuid(), '${tenant.id}', c.id, 'celular', (ARRAY['Samsung','Motorola','Apple','Xiaomi'])[1 + (c.n % 4)::int], 'Modelo ' || c.n
FROM c;
CREATE TEMP TABLE d AS SELECT id, customer_id, row_number() OVER (ORDER BY id) AS n FROM devices WHERE tenant_id = '${tenant.id}';
INSERT INTO work_orders (id, tenant_id, protocol, customer_id, device_id, reported_defect, state, opened_by, created_at, updated_at)
SELECT gen_random_uuid(), '${tenant.id}', '2026-' || lpad(i::text, 6, '0'), d.customer_id, d.id, 'Defeito sintético ' || i,
       (ARRAY['RECEBIDA','EM_DIAGNOSTICO','AGUARDANDO_APROVACAO','EM_REPARO','EM_TESTE','PRONTA_RETIRADA','ENTREGUE','ENCERRADA'])[1 + i % 8],
       '${owner.id}', now() - (i % ${SPREAD}) * interval '1 hour', now()
FROM generate_series(1, ${ORDERS}) i JOIN d ON d.n = 1 + (i % (SELECT count(*) FROM d));
INSERT INTO work_order_events (id, tenant_id, work_order_id, type, from_state, to_state, actor_user_id, created_at)
SELECT gen_random_uuid(), w.tenant_id, w.id, e.type, e.f, e.t, '${owner.id}', w.created_at + e.off
FROM work_orders w, (VALUES
  ('os_aberta', NULL, 'RECEBIDA', interval '0'),
  ('diagnostico_iniciado', 'RECEBIDA', 'EM_DIAGNOSTICO', interval '3 hours'),
  ('orcamento_enviado', 'EM_DIAGNOSTICO', 'AGUARDANDO_APROVACAO', interval '1 day'),
  ('orcamento_aprovado', 'AGUARDANDO_APROVACAO', 'EM_REPARO', interval '2 days')) AS e(type, f, t, off)
WHERE w.tenant_id = '${tenant.id}';
ANALYZE;`;
const seeded = spawnSync("docker", ["compose", "exec", "-T", "postgres", "psql", "-U", "postgres", "-d", DB, "-v", "ON_ERROR_STOP=1", "-q"], { cwd: root, input: sql, encoding: "utf8" });
if (seeded.status !== 0) { console.error("falha ao popular:", seeded.stderr); cleanup(); process.exit(1); }
const counts = psql(DB, `SELECT (SELECT count(*) FROM customers WHERE tenant_id='${tenant.id}'), (SELECT count(*) FROM devices WHERE tenant_id='${tenant.id}'), (SELECT count(*) FROM work_orders WHERE tenant_id='${tenant.id}'), (SELECT count(*) FROM work_order_events WHERE tenant_id='${tenant.id}')`);
console.log(`população (${((Date.now() - t0) / 1000).toFixed(1)} s): clientes|equipamentos|OS|eventos = ${counts}`);

// ---- medição ----
const get = async (path) => { const s = process.hrtime.bigint(); const r = await fetch(base + path, { headers: { cookie } }); await r.arrayBuffer(); return { ms: Number(process.hrtime.bigint() - s) / 1e6, status: r.status }; };
const pct = (xs, p) => xs.slice().sort((a, b) => a - b)[Math.min(xs.length - 1, Math.ceil((p / 100) * xs.length) - 1)];
const targets = [
  ["clientes (página 1)", "/api/v1/customers?limit=20"],
  ["clientes busca por nome (com resultado)", "/api/v1/customers?q=silva&limit=20"],
  ["clientes busca por nome (sem resultado)", "/api/v1/customers?q=zzzzqq&limit=20"],
  ["clientes busca por telefone", "/api/v1/customers?q=85900100000&limit=20"],
  ["OS lista (página 1)", "/api/v1/work-orders?limit=20"],
  ["OS filtro por estado", "/api/v1/work-orders?state=EM_REPARO&limit=20"],
  ["OS busca por protocolo", "/api/v1/work-orders?q=2026-0001&limit=20"],
  ["equipamentos busca (marca/modelo/cliente)", "/api/v1/devices?q=samsung&limit=20"],
  ["dashboard (período padrão)", "/api/v1/dashboard"],
];
const rows = [];
for (const [label, path] of targets) {
  for (let i = 0; i < 5; i += 1) await get(path);
  const seq = [];
  let status = 0;
  for (let i = 0; i < RUNS; i += 1) { const r = await get(path); seq.push(r.ms); status = r.status; }
  const t1 = process.hrtime.bigint();
  const burst = await Promise.all(Array.from({ length: 16 }, () => get(path)));
  const burstMs = Number(process.hrtime.bigint() - t1) / 1e6;
  rows.push({ label, status, p50: pct(seq, 50), p95: pct(seq, 95), max: Math.max(...seq), burst16: burstMs, burstP95: pct(burst.map((b) => b.ms), 95) });
}
console.log(`\nendpoint (${RUNS} chamadas em série; 16 simultâneas)`.padEnd(50) + "HTTP   p50 ms   p95 ms   max ms   16 simult. total/p95 ms");
for (const r of rows) console.log(r.label.padEnd(50) + String(r.status).padEnd(7) + r.p50.toFixed(1).padStart(6) + r.p95.toFixed(1).padStart(9) + r.max.toFixed(1).padStart(9) + `   ${r.burst16.toFixed(0)} / ${r.burstP95.toFixed(0)}`);

// ---- planos das buscas por texto ----
const plan = (title, query) => {
  const res = compose(["psql", "-U", "postgres", "-d", DB, "-At", "-c", `EXPLAIN (ANALYZE, BUFFERS, COSTS OFF, TIMING OFF) ${query}`]);
  console.log(`\n--- plano: ${title}\n${res.stdout.trim().split("\n").filter((l) => /Scan|Index|Sort|Execution|Planning|Rows Removed|Buffers/.test(l)).slice(0, 8).join("\n")}`);
};
plan("clientes por nome ILIKE '%silva%'", `SELECT id FROM customers WHERE tenant_id='${tenant.id}' AND name ILIKE '%silva%' ORDER BY created_at DESC, id DESC LIMIT 20`);
plan("clientes por nome sem resultado", `SELECT id FROM customers WHERE tenant_id='${tenant.id}' AND name ILIKE '%zzzzqq%' ORDER BY created_at DESC, id DESC LIMIT 20`);
plan("OS por protocolo (prefixo)", `SELECT id FROM work_orders WHERE tenant_id='${tenant.id}' AND protocol ILIKE '2026-0001%' ORDER BY created_at DESC, id DESC LIMIT 20`);
plan("eventos do dashboard (todos da empresa)", `SELECT work_order_id, to_state, created_at FROM work_order_events WHERE tenant_id='${tenant.id}' AND to_state IS NOT NULL`);

// ---- limpeza do banco de teste ----
cleanup();
psql(DB, "TRUNCATE audit_events, sessions, memberships, users, tenants CASCADE");
console.log("\nbanco de teste limpo.");
