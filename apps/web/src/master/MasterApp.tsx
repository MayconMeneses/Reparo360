import { useEffect, useState, type FormEvent } from "react";
import { Message, TextField } from "../ui/form";
import { masterApi, MasterApiError, setMasterCsrf } from "./masterApi";
import { TenantsPanel } from "./TenantsPanel";

type Step = "checking" | "password" | "code" | "panel";
type Notice = { kind: "ok" | "error"; text: string } | null;
const onlyDigits = (value: string) => value.replace(/\D/g, "").slice(0, 6);

/**
 * Administração da plataforma. Entrada em duas etapas (senha, depois código do autenticador); a sessão só
 * nasce na segunda. Não usa o login das assistências nem enxerga dados de clientes.
 */
export function MasterApp() {
  const [step, setStep] = useState<Step>("checking");
  const [adminName, setAdminName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [challenge, setChallenge] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  useEffect(() => {
    document.title = "Administração da plataforma — Reparo360";
    masterApi<{ admin: { name: string }; csrfToken: string }>("/me").then(
      (me) => { setMasterCsrf(me.csrfToken); setAdminName(me.admin.name); setStep("panel"); },
      () => setStep("password"),
    );
  }, []);

  async function run(task: () => Promise<void>) {
    setBusy(true);
    setNotice(null);
    try {
      await task();
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof MasterApiError ? error.message : "Não foi possível conectar agora." });
    } finally {
      setBusy(false);
    }
  }

  const submitPassword = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      const result = await masterApi<{ challenge: string }>("/auth/login", { method: "POST", body: { email, password } });
      setPassword("");
      setChallenge(result.challenge);
      setStep("code");
    });
  };

  const submitCode = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      try {
        const result = await masterApi<{ csrfToken: string }>("/auth/mfa", { method: "POST", body: { challenge, code } });
        setMasterCsrf(result.csrfToken);
        const me = await masterApi<{ admin: { name: string } }>("/me");
        setAdminName(me.admin.name);
        setCode("");
        setStep("panel");
      } catch (error) {
        setCode("");
        // O desafio vale poucas tentativas: depois de um erro de código, recomeça pela senha.
        if (error instanceof MasterApiError && error.status === 401) setStep("password");
        throw error;
      }
    });
  };

  async function signOut() {
    await masterApi("/auth/logout", { method: "POST", body: {} }).catch(() => undefined);
    setMasterCsrf(null);
    setStep("password");
  }

  return (
    <main style={{ maxWidth: 880, margin: "0 auto", padding: 16 }}>
      <p className="muted">Reparo360 · área restrita</p>
      <h1>Administração da plataforma</h1>
      {step === "checking" ? <p role="status" className="state">Carregando…</p> : null}
      {step === "password" ? (
        <form onSubmit={submitPassword} className="card" aria-labelledby="m-pass">
          <h2 id="m-pass">Entrar</h2>
          <TextField label="E-mail" type="email" value={email} onChange={setEmail} required autoComplete="username" />
          <TextField label="Senha" type="password" value={password} onChange={setPassword} required autoComplete="current-password" />
          <p><button type="submit" className="primary" disabled={busy || !email || !password}>Continuar</button></p>
          <Message message={notice} />
        </form>
      ) : null}
      {step === "code" ? (
        <form onSubmit={submitCode} className="card" aria-labelledby="m-code">
          <h2 id="m-code">Código do autenticador</h2>
          <p>Digite o código de 6 números do seu aplicativo autenticador.</p>
          <TextField label="Código" value={code} onChange={(value) => setCode(onlyDigits(value))} required inputMode="numeric" maxLength={6} autoComplete="one-time-code" />
          <p><button type="submit" className="primary" disabled={busy || code.length !== 6}>Entrar</button></p>
          <Message message={notice} />
        </form>
      ) : null}
      {step === "panel" ? (
        <>
          <p>Olá, {adminName}. <button type="button" onClick={() => void signOut()}>Sair</button></p>
          <TenantsPanel onSessionLost={() => { setMasterCsrf(null); setStep("password"); }} />
        </>
      ) : null}
    </main>
  );
}
