import { createHash, randomUUID } from "node:crypto";
import { schema, withContext } from "@reparo360/database";
import { TERMINAL_STATES, type AttachmentType, type WorkOrderState } from "@reparo360/domain";
import { and, eq, isNull, sql } from "drizzle-orm";
import { recordAudit } from "../../audit.js";
import type { AuthContext } from "../../auth-context.js";
import { HttpError } from "../../http-error.js";
import type { AppServices } from "../../services.js";
import type { RequestMeta } from "../identity/auth.service.js";
import { addEvent, loadOrderForActor, lockOrderById } from "../work-orders/access.js";
import { detectType } from "./signature.js";

export const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;
export const MAX_ATTACHMENTS_PER_ORDER = 20;

const ctxOf = (auth: AuthContext) => ({ tenantId: auth.tenantId, userId: auth.userId });
/** RN-007: OS encerrada ou cancelada é imutável, anexos inclusive. */
function assertOrderOpen(state: string): void {
  if (TERMINAL_STATES.includes(state as WorkOrderState)) {
    throw new HttpError(422, "OS_ENCERRADA", "Esta OS está encerrada e não aceita alterações.");
  }
}
const attachmentNotFound = () => new HttpError(404, "ANEXO_NAO_ENCONTRADO", "Anexo não encontrado.");

export async function uploadAttachment(
  deps: AppServices,
  auth: AuthContext,
  orderId: string,
  declaredType: string,
  data: Buffer,
  meta: RequestMeta,
) {
  if (data.length === 0) throw new HttpError(422, "ARQUIVO_VAZIO", "O arquivo está vazio.");
  if (data.length > MAX_ATTACHMENT_BYTES) throw new HttpError(413, "ARQUIVO_GRANDE_DEMAIS", "Arquivo acima do limite de 8 MB.");
  const detected = detectType(data);
  if (!detected) throw new HttpError(415, "TIPO_NAO_SUPORTADO", "Tipo de arquivo não suportado.");
  if (detected !== declaredType) {
    throw new HttpError(415, "CONTEUDO_DIVERGENTE", "O conteúdo do arquivo não corresponde ao tipo informado.");
  }

  const storageKey = `${auth.tenantId}/${randomUUID()}`;
  let written = false;
  try {
    return await withContext(deps.pool, ctxOf(auth), async (db) => {
      // A trava na OS serializa uploads simultâneos, então o limite por OS não é furado em corrida.
      const order = await loadOrderForActor(db, auth, orderId, true);
      assertOrderOpen(order.state);
      const [count] = await db
        .select({ total: sql<number>`count(*)::int` })
        .from(schema.attachments)
        .where(and(eq(schema.attachments.tenantId, auth.tenantId), eq(schema.attachments.workOrderId, order.id), isNull(schema.attachments.deletedAt)));
      if ((count?.total ?? 0) >= MAX_ATTACHMENTS_PER_ORDER) {
        throw new HttpError(409, "LIMITE_DE_ANEXOS", `Limite de ${MAX_ATTACHMENTS_PER_ORDER} anexos por OS atingido.`);
      }

      await deps.storage.put(storageKey, data);
      written = true;
      const [row] = await db
        .insert(schema.attachments)
        .values({
          tenantId: auth.tenantId,
          workOrderId: order.id,
          storageKey,
          contentType: detected,
          sizeBytes: data.length,
          sha256: createHash("sha256").update(data).digest("hex"),
          uploadedBy: auth.userId,
        })
        .returning({ id: schema.attachments.id, contentType: schema.attachments.contentType, sizeBytes: schema.attachments.sizeBytes });
      if (!row) throw new Error("insert de anexo não retornou linha");
      await addEvent(db, { tenantId: auth.tenantId, workOrderId: order.id, type: "anexo_adicionado", actorUserId: auth.userId });
      await recordAudit(db, {
        tenantId: auth.tenantId,
        actorUserId: auth.userId,
        action: "attachment_uploaded",
        targetType: "attachment",
        targetId: row.id,
        outcome: "ok",
        correlationId: meta.correlationId,
        ip: meta.ip,
      });
      return row;
    });
  } catch (error) {
    // Falha depois da gravação: não deixar o arquivo órfão. (Uma queda do processo entre
    // gravar e confirmar ainda pode deixar órfão; há varredura de órfãos pendente.)
    if (written) await deps.storage.remove(storageKey).catch(() => undefined);
    throw error;
  }
}

export async function downloadAttachment(deps: AppServices, auth: AuthContext, attachmentId: string, meta: RequestMeta) {
  const found = await withContext(deps.pool, ctxOf(auth), async (db) => {
    const [row] = await db
      .select()
      .from(schema.attachments)
      .where(and(eq(schema.attachments.tenantId, auth.tenantId), eq(schema.attachments.id, attachmentId), isNull(schema.attachments.deletedAt)))
      .limit(1);
    if (!row) throw attachmentNotFound();
    // A autorização é a da OS dona do anexo (técnico: só se atribuída a ele).
    try {
      await loadOrderForActor(db, auth, row.workOrderId);
    } catch {
      throw attachmentNotFound();
    }
    await recordAudit(db, {
      tenantId: auth.tenantId,
      actorUserId: auth.userId,
      action: "attachment_downloaded",
      targetType: "attachment",
      targetId: row.id,
      outcome: "ok",
      correlationId: meta.correlationId,
      ip: meta.ip,
    });
    return row;
  });
  const data = await deps.storage.get(found.storageKey);
  return { data, contentType: found.contentType as AttachmentType };
}

/** Exclusão lógica: o arquivo é preservado, o anexo some das listagens e downloads. */
export async function deleteAttachment(deps: AppServices, auth: AuthContext, attachmentId: string, meta: RequestMeta): Promise<void> {
  await withContext(deps.pool, ctxOf(auth), async (db) => {
    const [target] = await db
      .select({ workOrderId: schema.attachments.workOrderId })
      .from(schema.attachments)
      .where(and(eq(schema.attachments.tenantId, auth.tenantId), eq(schema.attachments.id, attachmentId), isNull(schema.attachments.deletedAt)))
      .limit(1);
    if (!target) throw attachmentNotFound();
    const order = await lockOrderById(db, auth.tenantId, target.workOrderId);
    if (order) assertOrderOpen(order.state);
    const [row] = await db
      .update(schema.attachments)
      .set({ deletedAt: new Date(), deletedBy: auth.userId })
      .where(and(eq(schema.attachments.tenantId, auth.tenantId), eq(schema.attachments.id, attachmentId), isNull(schema.attachments.deletedAt)))
      .returning({ workOrderId: schema.attachments.workOrderId });
    if (!row) throw attachmentNotFound();
    await addEvent(db, { tenantId: auth.tenantId, workOrderId: row.workOrderId, type: "anexo_removido", actorUserId: auth.userId });
    await recordAudit(db, {
      tenantId: auth.tenantId,
      actorUserId: auth.userId,
      action: "attachment_deleted",
      targetType: "attachment",
      targetId: attachmentId,
      outcome: "ok",
      correlationId: meta.correlationId,
      ip: meta.ip,
    });
  });
}
