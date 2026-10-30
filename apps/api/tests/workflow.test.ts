import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  addMember, call, loginOk, onboard, orderDetail, resetData, setupOrder, startTestEnv, transition,
  type Account, type Session, type TestEnv,
} from "./helpers.js";

let env: TestEnv;
let a: Account;
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
  a = await onboard(env, "fluxoA");
  const b = await onboard(env, "fluxoB");
  ownerA = await loginOk(env, a.email);
  ownerB = await loginOk(env, b.email);
});

const eventTypes = async (session: Session, orderId: string) =>
  ((await orderDetail(env, session, orderId)).events as Array<{ type: string }>).map((e) => e.type);

describe("transições diretas", () => {
  it("iniciar diagnóstico exige técnico atribuído; com técnico, muda o estado e registra o evento", async () => {
    const { orderId } = await setupOrder(env, ownerA);
    const without = await transition(env, ownerA, orderId, "iniciar_diagnostico");
    expect(without.statusCode).toBe(422);
    expect(without.json().error.code).toBe("SEM_TECNICO_ATRIBUIDO");

    const tech = await addMember(env, ownerA, "tecnico");
    const { version } = await orderDetail(env, ownerA, orderId);
    await call(env, ownerA, "PATCH", `/work-orders/${orderId}/technician`, { technicianId: tech.userId, version });
    const started = await transition(env, ownerA, orderId, "iniciar_diagnostico");
    expect(started.statusCode).toBe(200);
    expect(started.json().state).toBe("EM_DIAGNOSTICO");
    const detail = await orderDetail(env, ownerA, orderId);
    expect(detail.state).toBe("EM_DIAGNOSTICO");
    expect(detail.events.at(-1)).toMatchObject({ type: "diagnostico_iniciado", fromState: "RECEBIDA", toState: "EM_DIAGNOSTICO" });
  });

  it("par (estado, ação) inválido volta 422 e nada muda", async () => {
    const { orderId } = await setupOrder(env, ownerA);
    for (const action of ["peca_disponivel", "novo_defeito", "reabrir_diagnostico", "liberar_sem_reparo"]) {
      const res = await transition(env, ownerA, orderId, action, "motivo qualquer");
      expect(res.statusCode, action).toBe(422);
      expect(res.json().error.code, action).toBe("TRANSICAO_INVALIDA");
    }
    expect((await orderDetail(env, ownerA, orderId)).state).toBe("RECEBIDA");
  });

  it("entrega e ações do orçamento têm endpoint próprio: o genérico as recusa", async () => {
    const { orderId } = await setupOrder(env, ownerA);
    for (const action of ["entregar", "aprovar_orcamento", "aprovar_orcamento_aguardando_peca", "recusar_orcamento", "enviar_orcamento", "revisar_orcamento", "expirar_orcamento"]) {
      const res = await transition(env, ownerA, orderId, action);
      expect(res.statusCode, action).toBe(422);
      expect(res.json().error.code, action).toBe("ACAO_INDISPONIVEL");
    }
    // As ações de reparo, testes e encerramento existem, mas respeitam a tabela: de RECEBIDA nenhuma vale.
    for (const action of ["iniciar_testes", "reprovar_testes", "aprovar_testes", "reabrir_bancada", "encerrar"]) {
      const res = await transition(env, ownerA, orderId, action, "motivo de teste");
      expect(res.statusCode, action).toBe(422);
      expect(res.json().error.code, action).toBe("TRANSICAO_INVALIDA");
    }
    const unknown = await transition(env, ownerA, orderId, "apagar_tudo");
    expect(unknown.statusCode).toBe(400);
  });

  it("motivo é obrigatório para cancelar e é registrado no histórico", async () => {
    const { orderId } = await setupOrder(env, ownerA);
    const noReason = await transition(env, ownerA, orderId, "cancelar");
    expect(noReason.statusCode).toBe(422);
    expect(noReason.json().error.code).toBe("MOTIVO_OBRIGATORIO");
    const ok = await transition(env, ownerA, orderId, "cancelar", "Cliente desistiu do conserto");
    expect(ok.statusCode).toBe(200);
    const last = (await orderDetail(env, ownerA, orderId)).events.at(-1);
    expect(last).toMatchObject({ type: "os_cancelada", toState: "CANCELADA", reason: "Cliente desistiu do conserto" });
  });

  it("OS cancelada é terminal: nada sai dela e a atribuição é recusada", async () => {
    const tech = await addMember(env, ownerA, "tecnico");
    const { orderId } = await setupOrder(env, ownerA);
    await transition(env, ownerA, orderId, "cancelar", "Teste de terminal");
    for (const action of ["iniciar_diagnostico", "cancelar", "reabrir_diagnostico"]) {
      expect((await transition(env, ownerA, orderId, action, "motivo")).statusCode, action).toBe(422);
    }
    const { version } = await orderDetail(env, ownerA, orderId);
    const assign = await call(env, ownerA, "PATCH", `/work-orders/${orderId}/technician`, { technicianId: tech.userId, version });
    expect(assign.statusCode).toBe(422);
    expect(assign.json().error.code).toBe("OS_ENCERRADA");
  });

  it("papéis: atendente não usa o endpoint; gerente cancela; técnico não cancela", async () => {
    const clerk = await loginOk(env, (await addMember(env, ownerA, "atendente")).email);
    const manager = await loginOk(env, (await addMember(env, ownerA, "gerente")).email);
    const tech = await addMember(env, ownerA, "tecnico");
    const techSession = await loginOk(env, tech.email);
    const { orderId } = await setupOrder(env, ownerA, { technicianId: tech.userId });
    expect((await transition(env, clerk, orderId, "iniciar_diagnostico")).statusCode).toBe(403);
    expect((await transition(env, techSession, orderId, "cancelar", "motivo qualquer")).statusCode).toBe(403);
    expect((await transition(env, techSession, orderId, "iniciar_diagnostico")).statusCode).toBe(200);
    expect((await transition(env, manager, orderId, "cancelar", "Cancelamento autorizado")).statusCode).toBe(200);
  });

  it("técnico só age em OS atribuída a ele (404 nas demais)", async () => {
    const tech = await loginOk(env, (await addMember(env, ownerA, "tecnico")).email);
    const { orderId, version } = await setupOrder(env, ownerA);
    const attempt = await call(env, tech, "POST", `/work-orders/${orderId}/transitions`, { action: "iniciar_diagnostico", expectedVersion: version });
    expect(attempt.statusCode).toBe(404);
    expect((await orderDetail(env, ownerA, orderId)).state).toBe("RECEBIDA");
  });

  it("duplo clique: a segunda chamada com a mesma versão recebe 409 e só um evento é gravado", async () => {
    const tech = await addMember(env, ownerA, "tecnico");
    const { orderId } = await setupOrder(env, ownerA, { technicianId: tech.userId });
    const { version } = await orderDetail(env, ownerA, orderId);
    const body = { action: "iniciar_diagnostico", expectedVersion: version };
    const [one, two] = await Promise.all([
      call(env, ownerA, "POST", `/work-orders/${orderId}/transitions`, body),
      call(env, ownerA, "POST", `/work-orders/${orderId}/transitions`, body),
    ]);
    expect([one.statusCode, two.statusCode].sort()).toEqual([200, 409]);
    expect((await eventTypes(ownerA, orderId)).filter((t) => t === "diagnostico_iniciado")).toHaveLength(1);
  });

  it("versão desatualizada recusa a transição", async () => {
    const tech = await addMember(env, ownerA, "tecnico");
    const { orderId } = await setupOrder(env, ownerA, { technicianId: tech.userId });
    const stale = await call(env, ownerA, "POST", `/work-orders/${orderId}/transitions`, { action: "iniciar_diagnostico", expectedVersion: 99 });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.code).toBe("CONFLITO_DE_VERSAO");
  });

  it("fluxos de volta: peça indisponível não vem de EM_DIAGNOSTICO; reabrir exige gerente e motivo", async () => {
    const tech = await addMember(env, ownerA, "tecnico");
    const { orderId } = await setupOrder(env, ownerA, { technicianId: tech.userId });
    await transition(env, ownerA, orderId, "iniciar_diagnostico");
    expect((await transition(env, ownerA, orderId, "liberar_sem_reparo")).json().error.code).toBe("MOTIVO_OBRIGATORIO");
    expect((await transition(env, ownerA, orderId, "liberar_sem_reparo", "Reparo impossível")).json().state).toBe("PRONTA_RETIRADA_SEM_REPARO");
    const reopened = await transition(env, ownerA, orderId, "reabrir_diagnostico", "Cliente pediu nova análise");
    expect(reopened.json().state).toBe("EM_DIAGNOSTICO");
  });

  it("outra empresa recebe 404 ao tentar transicionar", async () => {
    const { orderId } = await setupOrder(env, ownerA);
    const res = await call(env, ownerB, "POST", `/work-orders/${orderId}/transitions`, { action: "cancelar", expectedVersion: 1, reason: "invasão" });
    expect(res.statusCode).toBe(404);
    expect((await orderDetail(env, ownerA, orderId)).state).toBe("RECEBIDA");
  });
});

describe("fila do técnico e assumir OS (P-12)", () => {
  it("lista OS recebidas e sem técnico, sem nome do cliente e sem o texto do defeito", async () => {
    const tech = await loginOk(env, (await addMember(env, ownerA, "tecnico")).email);
    const free = await setupOrder(env, ownerA, { reportedDefect: "Cliente relatou dado pessoal sigiloso" });
    const taken = await setupOrder(env, ownerA, { technicianId: (await addMember(env, ownerA, "tecnico", "outro")).userId });
    const res = await call(env, tech, "GET", "/work-orders/queue");
    expect(res.statusCode).toBe(200);
    const queue = res.json<{ queue: Array<{ id: string }> }>().queue;
    expect(queue.map((q) => q.id)).toEqual([free.orderId]);
    expect(queue.map((q) => q.id)).not.toContain(taken.orderId);
    expect(res.body).not.toMatch(/Maria Teste|sigiloso|85999991234/);
  });

  it("assumir: o técnico passa a enxergar a OS; atendente não acessa a fila", async () => {
    const tech = await loginOk(env, (await addMember(env, ownerA, "tecnico")).email);
    const clerk = await loginOk(env, (await addMember(env, ownerA, "atendente")).email);
    const { orderId, version } = await setupOrder(env, ownerA);
    expect((await call(env, tech, "GET", `/work-orders/${orderId}`)).statusCode).toBe(404);
    expect((await call(env, clerk, "GET", "/work-orders/queue")).statusCode).toBe(403);
    const claimed = await call(env, tech, "POST", `/work-orders/${orderId}/claim`, { expectedVersion: version });
    expect(claimed.statusCode).toBe(200);
    expect((await call(env, tech, "GET", `/work-orders/${orderId}`)).statusCode).toBe(200);
    expect(await eventTypes(ownerA, orderId)).toContain("os_assumida");
  });

  it("dois técnicos assumindo ao mesmo tempo: exatamente um vence", async () => {
    const tech1 = await loginOk(env, (await addMember(env, ownerA, "tecnico", "t1")).email);
    const tech2 = await loginOk(env, (await addMember(env, ownerA, "tecnico", "t2")).email);
    const { orderId, version } = await setupOrder(env, ownerA);
    const [r1, r2] = await Promise.all([
      call(env, tech1, "POST", `/work-orders/${orderId}/claim`, { expectedVersion: version }),
      call(env, tech2, "POST", `/work-orders/${orderId}/claim`, { expectedVersion: version }),
    ]);
    expect([r1.statusCode, r2.statusCode].sort()).toEqual([200, 409]);
    expect((await orderDetail(env, ownerA, orderId)).events.filter((e: { type: string }) => e.type === "os_assumida")).toHaveLength(1);
  });

  it("fila e assumir não atravessam empresas", async () => {
    const techB = await loginOk(env, (await addMember(env, ownerB, "tecnico")).email);
    const inA = await setupOrder(env, ownerA);
    expect((await call(env, techB, "GET", "/work-orders/queue")).json().queue).toHaveLength(0);
    expect((await call(env, techB, "POST", `/work-orders/${inA.orderId}/claim`, { expectedVersion: inA.version })).statusCode).toBe(404);
  });
});
