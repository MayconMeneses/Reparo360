import { z } from "zod";

export const pagination = {
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
};

/** Escapa curingas do LIKE para que a busca do usuário seja sempre texto literal. */
export function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, (char) => `\\${char}`);
}
