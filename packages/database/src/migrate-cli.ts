import { runMigrations } from "./migrate.js";

const envName = process.argv.includes("--test") ? "TEST_MIGRATION_DATABASE_URL" : "MIGRATION_DATABASE_URL";
const url = process.env[envName];
if (!url) {
  console.error(`${envName} não definida`);
  process.exit(1);
}
await runMigrations(url);
console.log(`migrações aplicadas (${envName})`);
