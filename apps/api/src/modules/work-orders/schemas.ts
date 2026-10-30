import { CHECKLIST_RESULTS, TRANSITION_ACTIONS, WORK_ORDER_PRIORITIES, WORK_ORDER_STATES } from "@reparo360/domain";
import { z } from "zod";
import { pagination } from "../shared/query.js";

const checklistItem = z.strictObject({ item: z.string().trim().min(1).max(60), result: z.enum(CHECKLIST_RESULTS) });

const inspection = z.strictObject({
  physicalCondition: z.string().trim().min(1).max(1000),
  accessories: z.array(z.string().trim().min(1).max(60)).max(20).default([]),
  checklist: z
    .array(checklistItem)
    .max(40)
    .default([])
    .refine((items) => new Set(items.map((i) => i.item.toLowerCase())).size === items.length, { message: "Itens do checklist repetidos." }),
  /** Apenas se a senha do aparelho foi informada; ela nunca é armazenada (P-08). */
  passwordInformed: z.boolean().default(false),
});

export const openWorkOrderBody = z.strictObject({
  customerId: z.uuid(),
  deviceId: z.uuid(),
  reportedDefect: z.string().trim().min(3).max(2000),
  priority: z.enum(WORK_ORDER_PRIORITIES).default("normal"),
  technicianId: z.uuid().optional(),
  /** Retorno ou reclamação posterior: OS anterior (entregue ou encerrada) do mesmo equipamento. */
  originWorkOrderId: z.uuid().optional(),
  inspection,
});
export type OpenWorkOrderInput = z.infer<typeof openWorkOrderBody>;

export const idempotencyHeader = z.string().trim().min(8).max(100).optional();

export const assignTechnicianBody = z.strictObject({
  technicianId: z.uuid().nullable(),
  /** Versão da OS que o cliente viu; evita sobrescrever alteração concorrente. */
  version: z.number().int().min(1),
});

export const transitionBody = z.strictObject({
  action: z.enum(TRANSITION_ACTIONS),
  /** Versão da OS que o cliente viu. Duplo clique: a segunda chamada recebe 409. */
  expectedVersion: z.number().int().min(1),
  reason: z.string().trim().min(3).max(500).optional(),
});

export const claimBody = z.strictObject({ expectedVersion: z.number().int().min(1) });

export const listWorkOrdersQuery = z.strictObject({
  state: z.enum(WORK_ORDER_STATES).optional(),
  q: z.string().trim().min(1).max(30).optional(),
  ...pagination,
});

export const workOrderParams = z.strictObject({ workOrderId: z.uuid() });
