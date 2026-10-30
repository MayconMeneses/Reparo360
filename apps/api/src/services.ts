import type pg from "pg";
import type { Config } from "./config.js";
import type { FileStorage } from "./modules/attachments/storage.js";

/** Dependências compartilhadas pelos módulos. `clock` é injetável para testar a virada de ano. */
export interface AppServices {
  config: Config;
  pool: pg.Pool;
  storage: FileStorage;
  clock: () => Date;
}
