const grouping = new Intl.NumberFormat("pt-BR", { useGrouping: true, maximumFractionDigits: 0 });

/** Centavos inteiros em reais, sem divisão em ponto flutuante nos centavos. */
export function formatBrl(cents: number): string {
  if (!Number.isSafeInteger(cents) || cents < 0) return "—";
  return `R$ ${grouping.format(Math.trunc(cents / 100))},${String(cents % 100).padStart(2, "0")}`;
}

export const formatDateTime = (iso: string | null | undefined): string =>
  iso ? new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }).format(new Date(iso)) : "—";

export const STATE_LABEL: Record<string, string> = {
  RECEBIDA: "Recebida",
  EM_DIAGNOSTICO: "Em diagnóstico",
  AGUARDANDO_APROVACAO: "Aguardando aprovação",
  AGUARDANDO_PECA: "Aguardando peça",
  EM_REPARO: "Em reparo",
  EM_TESTE: "Em teste",
  PRONTA_RETIRADA: "Pronta para retirada",
  PRONTA_RETIRADA_SEM_REPARO: "Pronta (sem reparo)",
  ENTREGUE: "Entregue",
  ENCERRADA: "Encerrada",
  CANCELADA: "Cancelada",
};

export const stateLabel = (code: string): string => STATE_LABEL[code] ?? code;

export const QUOTE_STATE_LABEL: Record<string, string> = {
  enviado: "Enviado",
  aprovado: "Aprovado",
  recusado: "Recusado",
  expirado: "Expirado",
  substituido: "Substituído",
};

export const ROLE_LABEL: Record<string, string> = { proprietario: "Proprietário", gerente: "Gerente", atendente: "Atendente", tecnico: "Técnico" };

/** Lê o token do link do consumidor do FRAGMENTO (#t=...), que o navegador nunca envia ao servidor. */
export function tokenFromHash(hash: string): string | null {
  const match = /^#t=([A-Za-z0-9_-]{20,100})$/.exec(hash);
  return match?.[1] ?? null;
}

/** Telefone nacional em dígitos para a máscara de exibição. */
export function formatPhone(digits: string): string {
  if (digits.length === 11) return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  if (digits.length === 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  return digits;
}

export const CATEGORY_OPTIONS = [
  { value: "celular", label: "Celular" }, { value: "tablet", label: "Tablet" }, { value: "notebook", label: "Notebook" },
  { value: "computador", label: "Computador" }, { value: "console", label: "Videogame / console" }, { value: "outro", label: "Outro" },
] as const;
