import { schema, withContext } from "@reparo360/database";
import { isRestrictedToAssigned } from "@reparo360/domain";
import { and, eq } from "drizzle-orm";
import { recordAudit } from "../../audit.js";
import type { AuthContext } from "../../auth-context.js";
import { HttpError } from "../../http-error.js";
import type { AppServices } from "../../services.js";
import type { RequestMeta } from "../identity/auth.service.js";
import { loadOrderForActor } from "../work-orders/access.js";
import { buildReceiptPdf } from "./receipt.pdf.js";

/** Gera o comprovante de recebimento de uma OS visível ao ator. Devolve o PDF e o protocolo. */
export async function generateReceipt(
  deps: AppServices,
  auth: AuthContext,
  orderId: string,
  meta: RequestMeta,
): Promise<{ pdf: Buffer; protocol: string }> {
  // O comprovante traz dados de contato do cliente: não é emitido a papéis restritos.
  if (isRestrictedToAssigned(auth.role)) throw new HttpError(403, "PERMISSAO_NEGADA", "Você não tem permissão para esta ação.");

  const data = await withContext(deps.pool, { tenantId: auth.tenantId, userId: auth.userId }, async (db) => {
    const order = await loadOrderForActor(db, auth, orderId);
    const [tenant] = await db.select().from(schema.tenants).where(eq(schema.tenants.id, auth.tenantId)).limit(1);
    const [customer] = await db
      .select()
      .from(schema.customers)
      .where(and(eq(schema.customers.tenantId, auth.tenantId), eq(schema.customers.id, order.customerId)))
      .limit(1);
    const [device] = await db
      .select()
      .from(schema.devices)
      .where(and(eq(schema.devices.tenantId, auth.tenantId), eq(schema.devices.id, order.deviceId)))
      .limit(1);
    const [inspection] = await db
      .select()
      .from(schema.intakeInspections)
      .where(and(eq(schema.intakeInspections.tenantId, auth.tenantId), eq(schema.intakeInspections.workOrderId, order.id)))
      .limit(1);
    if (!tenant || !customer || !device || !inspection) throw new Error("dados da OS incompletos");
    const [receiver] = await db
      .select({ name: schema.users.name })
      .from(schema.users)
      .where(eq(schema.users.id, inspection.receivedBy))
      .limit(1);

    await recordAudit(db, {
      tenantId: auth.tenantId,
      actorUserId: auth.userId,
      action: "document_receipt_generated",
      targetType: "work_order",
      targetId: order.id,
      outcome: "ok",
      correlationId: meta.correlationId,
      ip: meta.ip,
    });
    return {
      tenantName: tenant.tradeName ?? tenant.name,
      protocol: order.protocol,
      receivedAt: inspection.receivedAt,
      issuedAt: deps.clock(),
      receivedByName: receiver?.name ?? "—",
      customerName: customer.name,
      customerPhone: customer.phone,
      device,
      reportedDefect: order.reportedDefect,
      physicalCondition: inspection.physicalCondition,
      accessories: inspection.accessories,
      checklist: inspection.checklist,
      passwordInformed: inspection.passwordInformed,
    };
  });
  return { pdf: await buildReceiptPdf(data), protocol: data.protocol };
}
