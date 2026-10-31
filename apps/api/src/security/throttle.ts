/**
 * Limite de tentativas falhas por chave (IP + conta). Não trava a conta de verdade: a chave inclui o IP,
 * então um atacante não consegue bloquear a vítima a partir de outro endereço. Em memória e por instância
 * (vira limite compartilhado em P-20). O horário vem de um relógio injetável para teste.
 */
export class FailureThrottle {
  private readonly failures = new Map<string, number[]>();

  constructor(
    private readonly maxFailures: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  private recent(key: string): number[] {
    const cutoff = this.now() - this.windowMs;
    const list = (this.failures.get(key) ?? []).filter((at) => at > cutoff);
    if (list.length === 0) this.failures.delete(key);
    else this.failures.set(key, list);
    return list;
  }

  isBlocked(key: string): boolean {
    return this.recent(key).length >= this.maxFailures;
  }

  fail(key: string): void {
    const list = this.recent(key);
    list.push(this.now());
    this.failures.set(key, list);
    // Teto de memória: chaves expiradas saem ao serem consultadas; aqui só se evita crescer sem limite.
    if (this.failures.size > 50_000) this.failures.delete(this.failures.keys().next().value as string);
  }

  reset(key: string): void {
    this.failures.delete(key);
  }
}

export const accountKey = (ip: string, email: string): string => `${ip}|${email.trim().toLowerCase()}`;
