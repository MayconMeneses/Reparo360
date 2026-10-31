import { useState, type FormEvent } from "react";
import { api, ApiError } from "../api";
import { useAuth } from "../auth";

/** Primeiro acesso com senha temporária (conta criada pela plataforma): nada mais abre antes desta troca. */
export function ChangePasswordPage() {
  const { refresh, logout } = useAuth();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (next !== confirm) { setError("A confirmação não confere com a nova senha."); return; }
    setBusy(true);
    try {
      await api("/auth/change-password", { method: "POST", body: { currentPassword: current, newPassword: next } });
      setCurrent(""); setNext(""); setConfirm("");
      await refresh();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Falha de conexão. Tente novamente.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login">
      <h1>Defina sua senha</h1>
      <p>Você entrou com uma senha temporária. Escolha uma senha só sua para continuar.</p>
      <form onSubmit={(event) => void submit(event)} noValidate>
        {error ? <p role="alert" className="error">{error}</p> : null}
        <label htmlFor="cur">Senha temporária</label>
        <input id="cur" type="password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} />
        <label htmlFor="new">Nova senha</label>
        <input id="new" type="password" autoComplete="new-password" required minLength={12} value={next} onChange={(e) => setNext(e.target.value)} aria-describedby="new-hint" />
        <p id="new-hint" className="muted">Mínimo de 12 caracteres.</p>
        <label htmlFor="conf">Repita a nova senha</label>
        <input id="conf" type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        <p style={{ marginTop: 16 }}>
          <button type="submit" className="primary" disabled={busy || next.length < 12 || !current}>{busy ? "Salvando…" : "Salvar nova senha"}</button>{" "}
          <button type="button" onClick={() => void logout()}>Sair</button>
        </p>
      </form>
    </main>
  );
}
