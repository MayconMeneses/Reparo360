export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

interface PgErrorShape {
  code?: string;
  constraint?: string;
  cause?: { code?: string; constraint?: string };
}

/** Violação de unicidade do PostgreSQL, com o erro possivelmente embrulhado pelo Drizzle. */
export function isUniqueViolation(error: unknown, constraint?: string): boolean {
  const e = error as PgErrorShape | null;
  const code = e?.cause?.code ?? e?.code;
  if (code !== "23505") return false;
  return constraint === undefined || (e?.cause?.constraint ?? e?.constraint) === constraint;
}
