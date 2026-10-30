import { hash, verify, type Algorithm } from "@node-rs/argon2";

// Argon2id explícito (não depender do padrão da biblioteca). Parâmetros no
// mínimo recomendado pela OWASP: 19 MiB, 2 iterações, 1 thread. O valor 2 é Algorithm.Argon2id.
const OPTIONS = { algorithm: 2 as Algorithm, memoryCost: 19456, timeCost: 2, parallelism: 1 };

export function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

let dummyHash: Promise<string> | undefined;

/**
 * Verifica a senha. Quando o usuário não existe (`storedHash` nulo), verifica
 * contra um hash descartável para que o tempo e o corpo da resposta não revelem
 * se o e-mail está cadastrado.
 */
export async function verifyPassword(storedHash: string | null, password: string): Promise<boolean> {
  if (storedHash === null) {
    dummyHash ??= hashPassword("senha-descartavel-para-igualar-o-tempo");
    await verify(await dummyHash, password);
    return false;
  }
  try {
    return await verify(storedHash, password);
  } catch {
    return false;
  }
}
