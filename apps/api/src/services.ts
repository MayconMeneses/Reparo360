import type pg from "pg";
import type { Config } from "./config.js";
import type { Mailer } from "./mail/mailer.js";
import type { FailureThrottle } from "./security/throttle.js";
import type { FileStorage } from "./modules/attachments/storage.js";

/** Dependências compartilhadas pelos módulos. `clock` é injetável para testar a virada de ano. */
export interface AppServices {
  config: Config;
  pool: pg.Pool;
  storage: FileStorage;
  clock: () => Date;
  loginThrottle: FailureThrottle;
  mailer: Mailer;
  /** Pedidos de redefinição de senha por IP+e-mail (contagem; acima do limite o envio para, a resposta não muda). */
  resetThrottle: FailureThrottle;
}
