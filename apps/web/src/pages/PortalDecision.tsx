import { useState } from "react";
import { Message, TextField } from "../ui/form";

type Notice = { kind: "ok" | "error"; text: string } | null;

async function portalPost(token: string, path: string, body: object): Promise<{ ok: boolean; data: { error?: { message?: string } } }> {
  try {
    const response = await fetch(`/api/v1/portal/${path}`, {
      method: "POST",
      headers: { "x-portal-token": token, "content-type": "application/json" },
      credentials: "omit",
      body: JSON.stringify(body),
    });
    const data = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
    return { ok: response.ok, data };
  } catch {
    return { ok: false, data: { error: { message: "Não foi possível conectar agora. Tente novamente em instantes." } } };
  }
}

/**
 * Aprovar ou recusar à distância: o código vai ao e-mail JÁ cadastrado pela assistência (nunca a um endereço
 * digitado aqui). A decisão só vale com o código; o servidor confere tudo de novo.
 */
export function PortalDecision({ token, emailHint, onDecided }: { token: string; emailHint?: string; onDecided: () => void }) {
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  async function requestCode() {
    setBusy(true);
    setNotice(null);
    const result = await portalPost(token, "verification", {});
    setBusy(false);
    if (result.ok) {
      setSent(true);
      setNotice({ kind: "ok", text: `Enviamos um código para ${emailHint ?? "o seu e-mail cadastrado"}. Ele vale por 10 minutos.` });
    } else {
      setNotice({ kind: "error", text: result.data.error?.message ?? "Não foi possível enviar o código." });
    }
  }

  async function decide(decision: "aprovado" | "recusado") {
    setBusy(true);
    setNotice(null);
    const result = await portalPost(token, "decision", { decision, code });
    setBusy(false);
    if (result.ok) {
      onDecided();
    } else {
      setNotice({ kind: "error", text: result.data.error?.message ?? "Não foi possível registrar a decisão." });
    }
  }

  return (
    <section className="card" aria-labelledby="p-decide" style={{ marginTop: 16 }}>
      <h2 id="p-decide">Aprovar ou recusar o orçamento</h2>
      {!sent ? (
        <>
          <p>Para sua segurança, enviaremos um código ao e-mail cadastrado na assistência{emailHint ? ` (${emailHint})` : ""}.</p>
          <p><button type="button" className="primary" disabled={busy} onClick={requestCode}>Enviar código por e-mail</button></p>
        </>
      ) : (
        <>
          <TextField label="Código recebido por e-mail" value={code} onChange={(value) => setCode(value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" maxLength={6} autoComplete="one-time-code" hint="6 números" />
          <div className="actions">
            <button type="button" className="primary" disabled={busy || code.length !== 6} onClick={() => decide("aprovado")}>Aprovar orçamento</button>
            <button type="button" disabled={busy || code.length !== 6} onClick={() => decide("recusado")}>Recusar orçamento</button>
            <button type="button" disabled={busy} onClick={requestCode}>Enviar outro código</button>
          </div>
        </>
      )}
      <Message message={notice} />
    </section>
  );
}
