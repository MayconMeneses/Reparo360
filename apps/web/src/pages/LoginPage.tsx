import { useState, type FormEvent } from "react";
import { ApiError } from "../api";
import { useAuth } from "../auth";
import { useAuthOptions } from "../authOptions";

interface TenantChoice { id: string; name: string }

export function LoginPage() {
  const { login } = useAuth();
  const options = useAuthOptions();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [tenants, setTenants] = useState<TenantChoice[]>([]);
  const [tenantId, setTenantId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login({ email, password, tenantId: tenantId || undefined });
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === "SELECAO_DE_EMPRESA_NECESSARIA") {
        const list = (caught.details as { tenants?: TenantChoice[] } | undefined)?.tenants ?? [];
        setTenants(list);
        setTenantId(list[0]?.id ?? "");
        setError("Sua conta participa de mais de uma assistência. Escolha com qual deseja entrar.");
      } else {
        setError(caught instanceof ApiError ? caught.message : "Falha de conexão. Tente novamente.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login">
      <h1>Entrar no Reparo360</h1>
      <form onSubmit={submit} noValidate>
        {error ? <p role="alert" className="error">{error}</p> : null}
        <label htmlFor="email">E-mail</label>
        <input id="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <label htmlFor="password">Senha</label>
        <input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        {tenants.length > 0 ? (
          <>
            <label htmlFor="tenant">Assistência</label>
            <select id="tenant" value={tenantId} onChange={(e) => setTenantId(e.target.value)}>
              {tenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </>
        ) : null}
        <p style={{ marginTop: 16 }}>
          <button type="submit" className="primary" disabled={busy}>{busy ? "Entrando…" : "Entrar"}</button>
        </p>
      </form>
      {options.passwordReset ? <p><a href="/esqueci-senha">Esqueci minha senha</a></p> : null}
    </main>
  );
}
