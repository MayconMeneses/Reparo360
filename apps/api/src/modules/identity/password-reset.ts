import { withContext } from "@reparo360/database";
import { recordAudit } from "../../audit.js";
import { HttpError } from "../../http-error.js";
import { hashPassword } from "../../security/password.js";
import { accountKey } from "../../security/throttle.js";
import { hashToken, newToken } from "../../security/tokens.js";
import type { AppServices } from "../../services.js";
import type { RequestMeta } from "./auth.service.js";

export const RESET_TTL_MS = 30 * 60 * 1000;
export const INVITE_TTL_MS = 72 * 60 * 60 * 1000;
const MAX_RESETS_PER_HOUR = 3;

/** Só o que precisamos do logger: nunca recebe endereço de e-mail nem token. */
export interface MailLog {
  error(fields: object, message: string): void;
}

/**
 * O link vem SÓ da configuração (`PUBLIC_URL`), nunca do cabeçalho Host/Origin da requisição:
 * senão quem controla o cabeçalho faria o e-mail apontar para um site dele (envenenamento do link de redefinição).
 * O token fica no fragmento (#t=…): o navegador não o envia ao servidor, não entra em log de acesso nem em Referer.
 */
export function passwordLink(deps: AppServices, token: string): string {
  if (!deps.config.publicUrl) throw new Error("PUBLIC_URL ausente");
  return `${deps.config.publicUrl}/redefinir-senha#t=${token}`;
}

/** Envia depois de responder e engole a falha: o tempo e o resultado da resposta não podem revelar se a conta existe. */
export function sendLater(deps: AppServices, log: MailLog, mail: { to: string; subject: string; text: string }): void {
  setImmediate(() => {
    deps.mailer.send(mail).catch(() => log.error({ code: "ENVIO_DE_EMAIL_FALHOU" }, "falha ao enviar e-mail de senha"));
  });
}

/**
 * Pedido de redefinição. Devolve sempre o mesmo resultado (nada) exista a conta ou não, esteja o limite atingido ou não,
 * o envio ligado ou não. Só o e-mail de uma conta ativa recebe o link.
 */
export async function requestPasswordReset(deps: AppServices, email: string, meta: RequestMeta, log: MailLog): Promise<void> {
  const token = newToken(); // sempre gerado, para o caminho das contas inexistentes fazer o mesmo trabalho
  if (!deps.mailer.enabled) return;
  const key = `pwreset|${accountKey(meta.ip, email)}`;
  if (deps.resetThrottle.isBlocked(key)) return;
  deps.resetThrottle.fail(key); // cada pedido conta; acima do limite, para de enviar sem mudar a resposta
  const now = deps.clock();
  const result = await deps.pool.query<{ out_name: string; out_email: string }>(
    "SELECT * FROM pw_token_issue($1, $2, $3, $4, $5)",
    [email, hashToken(token), new Date(now.getTime() + RESET_TTL_MS), now, MAX_RESETS_PER_HOUR],
  );
  const row = result.rows[0];
  if (!row) return;
  sendLater(deps, log, {
    to: row.out_email,
    subject: "Redefinição de senha — Reparo360",
    text: `Olá, ${row.out_name}.\n\nPara escolher uma nova senha, abra o link abaixo (vale por ${RESET_TTL_MS / 60000} minutos e só pode ser usado uma vez):\n\n${passwordLink(deps, token)}\n\nSe não foi você, ignore esta mensagem: a sua senha continua a mesma.`,
  });
}

const invalidToken = () => new HttpError(400, "LINK_DE_SENHA_INVALIDO", "Link inválido, vencido ou já usado. Peça um novo.");

/**
 * Troca a senha com o token. A troca, o consumo do token (uso único), a invalidação dos outros tokens e a revogação de
 * TODAS as sessões da conta acontecem numa só operação do banco. Falha igual para token errado, vencido ou usado.
 */
export async function confirmPasswordReset(deps: AppServices, token: string, newPassword: string, meta: RequestMeta): Promise<void> {
  if (token.length < 20 || token.length > 100) throw invalidToken();
  const newHash = await hashPassword(newPassword); // o mesmo custo para token válido ou não
  let userId: string | null = null;
  try {
    const result = await deps.pool.query<{ id: string | null }>("SELECT pw_token_consume($1, $2, $3) AS id", [hashToken(token), newHash, deps.clock()]);
    userId = result.rows[0]?.id ?? null;
  } catch (error) {
    if ((error as { code?: string }).code !== "P0001") throw error; // conta inativa: a operação toda foi desfeita
  }
  if (!userId) throw invalidToken();
  await withContext(deps.pool, {}, (db) =>
    recordAudit(db, { actorUserId: userId, action: "password_reset_done", targetType: "user", targetId: userId, outcome: "ok", correlationId: meta.correlationId, ip: meta.ip }));
}
