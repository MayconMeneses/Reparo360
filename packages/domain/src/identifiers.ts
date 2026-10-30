/** Mantém só dígitos. Aceita número nacional (10 ou 11) com DDI 55 opcional. */
export function normalizePhone(input: string): string | null {
  let digits = input.replace(/\D/g, "");
  if (digits.length >= 12 && digits.length <= 13 && digits.startsWith("55")) digits = digits.slice(2);
  return digits.length === 10 || digits.length === 11 ? digits : null;
}

/** IMEI: 15 dígitos com dígito verificador de Luhn. */
export function isValidImei(value: string): boolean {
  if (!/^\d{15}$/.test(value)) return false;
  let sum = 0;
  for (let i = 0; i < 15; i++) {
    let digit = Number(value[14 - i]);
    if (i % 2 === 1) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  return sum % 10 === 0;
}

const PROTOCOL_TIME_ZONE = "America/Sao_Paulo";

/** Ano civil no fuso de São Paulo: 31/12 às 22h em Brasília já é janeiro em UTC. */
export function protocolYear(at: Date): number {
  return Number(new Intl.DateTimeFormat("en-CA", { timeZone: PROTOCOL_TIME_ZONE, year: "numeric" }).format(at));
}

/** Protocolo legível, ex.: 2026-000123. Não é credencial de acesso (RN-001). */
export function formatProtocol(year: number, sequence: number): string {
  return `${year}-${String(sequence).padStart(6, "0")}`;
}
