import { schema, withContext } from "@reparo360/database";
import type { Mail, Mailer } from "../src/mail/mailer.js";
import { diagnose, orderInDiagnosis, portalLink, sendQuote, type Account, type Session, type TestEnv } from "./helpers.js";

export const SECRET = "segredo-sintetico-de-teste-com-32-caracteres!";
export const PUBLIC_URL = "https://app.exemplo.invalid";
export const CUSTOMER_EMAIL = "maria.cliente@teste.invalid";

/** Coletor de e-mails para os testes. Fica fora de `src`: nenhum caminho de produção o instancia. */
export class MemoryMailer implements Mailer {
  readonly enabled = true;
  readonly outbox: Mail[] = [];
  failNext = false;
  async send(mail: Mail): Promise<void> {
    if (this.failNext) {
      this.failNext = false;
      throw new Error("falha simulada do provedor");
    }
    this.outbox.push(mail);
  }
  /** Código de 6 dígitos da última mensagem. */
  lastCode(): string {
    const mail = this.outbox.at(-1);
    const code = mail?.text.match(/é (\d{6})\./)?.[1];
    if (!code) throw new Error("nenhum código enviado");
    return code;
  }
}

/** Pedido público de código (aprovação remota). */
export function portalRequestCode(env: TestEnv, token: string, payload: object = {}) {
  return env.app.inject({ method: "POST", url: "/api/v1/portal/verification", headers: { "x-portal-token": token }, payload });
}

/** Decisão pública com o código recebido por e-mail. */
export function portalDecide(env: TestEnv, token: string, payload: object) {
  return env.app.inject({ method: "POST", url: "/api/v1/portal/decision", headers: { "x-portal-token": token }, payload });
}

/** OS aguardando aprovação, com link do consumidor. `email: null` simula cliente sem e-mail. */
export async function awaitingApproval(env: TestEnv, owner: Session, account: Account, email: string | null = CUSTOMER_EMAIL) {
  const order = await orderInDiagnosis(env, owner);
  await diagnose(env, order.techSession, order.orderId);
  const quote = await sendQuote(env, owner, order.orderId);
  await withContext(env.migrator, { tenantId: account.tenantId }, (db) => db.update(schema.customers).set({ email }));
  const link = await portalLink(env, owner, order.orderId);
  return { ...order, quote, token: link.token };
}
