import { useEffect, useState, type FormEvent } from "react";
import { tokenFromHash } from "../format";

type Notice = { kind: "ok" | "error"; text: string } | null;

async function publicPost(path: string, body: object): Promise<{ ok: boolean; message?: string }> {
  try {
    const response = await fetch(`/api/v1/auth/password-reset/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "omit",
      body: JSON.stringify(body),
    });
    if (response.ok) return { ok: true };
    const data = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
    return { ok: false, message: data?.error?.message };
  } catch {
    return { ok: false, message: "Não foi possível conectar agora. Tente novamente em instantes." };
  }
}

/** "Esqueci minha senha": a resposta é sempre a mesma, exista ou não a conta (o servidor também não diferencia). */
export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { document.title = "Esqueci minha senha — Reparo360"; }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const result = await publicPost("request", { email });
    setBusy(false);
    if (result.ok) setSent(true);
    else setError(result.message ?? "Não foi possível enviar agora.");
  }

  return (
    <main className="login">
      <h1>Esqueci minha senha</h1>
      {sent ? (
        <p role="status">Se existir uma conta com esse e-mail, enviamos um link para escolher uma nova senha. Ele vale por 30 minutos. Confira também a caixa de spam.</p>
      ) : (
        <form onSubmit={(event) => void submit(event)} noValidate>
          {error ? <p role="alert" className="error">{error}</p> : null}
          <label htmlFor="fp-email">E-mail da conta</label>
          <input id="fp-email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
          <p style={{ marginTop: 16 }}><button type="submit" className="primary" disabled={busy || email.trim() === ""}>{busy ? "Enviando…" : "Enviar link"}</button></p>
        </form>
      )}
      <p><a href="/">Voltar para a entrada</a></p>
    </main>
  );
}

/** Link do e-mail (redefinição ou convite): o token vem do fragmento (#t=…), é tirado do endereço na hora e vai no corpo. */
export function ResetPasswordPage() {
  const [token] = useState(() => tokenFromHash(window.location.hash));
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    document.title = "Definir senha — Reparo360";
    // O token não fica no histórico nem em marcadores do navegador.
    window.history.replaceState(null, "", window.location.pathname);
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!token) return;
    if (next !== confirm) { setNotice({ kind: "error", text: "A confirmação não confere com a nova senha." }); return; }
    setBusy(true);
    setNotice(null);
    const result = await publicPost("confirm", { token, newPassword: next });
    setBusy(false);
    if (result.ok) { setDone(true); setNext(""); setConfirm(""); }
    else setNotice({ kind: "error", text: result.message ?? "Não foi possível definir a senha." });
  }

  if (!token) {
    return (
      <main className="login">
        <h1>Link incompleto</h1>
        <p role="alert" className="error">Este endereço não tem o código do e-mail. Abra o link inteiro, ou peça outro.</p>
        <p><a href="/esqueci-senha">Pedir novo link</a></p>
      </main>
    );
  }
  if (done) {
    return (
      <main className="login">
        <h1>Senha definida</h1>
        <p role="status">Pronto. Todas as sessões antigas desta conta foram encerradas. Entre com a nova senha.</p>
        <p><a href="/">Ir para a entrada</a></p>
      </main>
    );
  }
  return (
    <main className="login">
      <h1>Definir nova senha</h1>
      <form onSubmit={(event) => void submit(event)} noValidate>
        {notice ? <p role="alert" className="error">{notice.text}</p> : null}
        <label htmlFor="rp-new">Nova senha</label>
        <input id="rp-new" type="password" autoComplete="new-password" required minLength={12} value={next} onChange={(e) => setNext(e.target.value)} aria-describedby="rp-hint" />
        <p id="rp-hint" className="muted">Mínimo de 12 caracteres.</p>
        <label htmlFor="rp-confirm">Repita a nova senha</label>
        <input id="rp-confirm" type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        <p style={{ marginTop: 16 }}><button type="submit" className="primary" disabled={busy || next.length < 12}>{busy ? "Salvando…" : "Salvar nova senha"}</button></p>
      </form>
      <p className="muted"><a href="/esqueci-senha">Pedir outro link</a></p>
    </main>
  );
}
