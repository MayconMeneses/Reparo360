// Cria (ou recadastra) um administrador da plataforma. É o ÚNICO caminho: nenhuma rota HTTP cria Master.
// Roda com o papel migrador (MIGRATION_DATABASE_URL). A senha vem do ambiente, nunca de argumento nem de chat.
//   MASTER_EMAIL=... MASTER_NAME=... MASTER_PASSWORD=... pnpm master:create
// Perdeu o autenticador? Rode de novo com MASTER_REENROLL=true: gera outro segredo MFA e troca a senha.
import pg from "pg";
import { hashPassword } from "../security/password.js";
import { openSecret, sealSecret } from "../modules/master/secret-box.js";
import { base32Encode, newTotpSecret, otpauthUri } from "../modules/master/totp.js";

function need(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`${name} não definida.`);
    process.exit(1);
  }
  return value;
}

const email = need("MASTER_EMAIL").trim().toLowerCase();
const name = need("MASTER_NAME").trim();
const password = need("MASTER_PASSWORD");
const keyHex = need("MASTER_ENC_KEY");
const reenroll = process.env["MASTER_REENROLL"] === "true";
if (password.length < 14) {
  console.error("MASTER_PASSWORD precisa ter ao menos 14 caracteres.");
  process.exit(1);
}
if (!/^[0-9a-fA-F]{64}$/.test(keyHex)) {
  console.error("MASTER_ENC_KEY precisa ter 64 caracteres hexadecimais.");
  process.exit(1);
}

const key = Buffer.from(keyHex, "hex");
const secret = newTotpSecret();
const sealed = sealSecret(key, secret);
if (!openSecret(key, sealed).equals(secret)) throw new Error("falha ao cifrar o segredo");
const passwordHash = await hashPassword(password);

const pool = new pg.Pool({ connectionString: need("MIGRATION_DATABASE_URL"), max: 1 });
try {
  const existing = await pool.query("SELECT id FROM platform_admins WHERE email = $1", [email]);
  if (existing.rowCount && !reenroll) {
    console.error("Já existe um administrador com este e-mail. Para trocar senha e autenticador, use MASTER_REENROLL=true.");
    process.exit(1);
  }
  if (existing.rowCount) {
    await pool.query(
      "UPDATE platform_admins SET name = $2, password_hash = $3, totp_secret_enc = $4, totp_last_step = 0, status = 'ativo', updated_at = now() WHERE email = $1",
      [email, name, passwordHash, sealed],
    );
    // Sessões e desafios antigos deixam de valer.
    await pool.query("UPDATE platform_sessions SET revoked_at = now() WHERE revoked_at IS NULL AND admin_id = (SELECT id FROM platform_admins WHERE email = $1)", [email]);
  } else {
    await pool.query("INSERT INTO platform_admins (email, name, password_hash, totp_secret_enc) VALUES ($1, $2, $3, $4)", [email, name, passwordHash, sealed]);
  }
  console.log(`Administrador ${reenroll && existing.rowCount ? "recadastrado" : "criado"}: ${email}`);
  console.log("Cadastre agora no aplicativo autenticador (mostrado UMA vez, não fica salvo em claro):");
  console.log(`  chave: ${base32Encode(secret)}`);
  console.log(`  uri:   ${otpauthUri(secret, email)}`);
} finally {
  await pool.end();
}
