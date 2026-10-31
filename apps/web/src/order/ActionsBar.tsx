import { ruleFor } from "@reparo360/domain";
import { useState } from "react";
import { api, ApiError } from "../api";
import { useAuth } from "../auth";
import { Message, TextArea, useAction } from "../ui/form";
import { ACTION_LABEL, availableActions, NEEDS_CONFIRMATION } from "./actions";
import type { TabProps } from "./types";

/**
 * Ações de estado da OS que o papel atual pode tentar. A lista é só apresentação:
 * o servidor confere estado, papel, versão e pré-condições (ex.: testes aprováveis) a cada chamada.
 */
export function ActionsBar({ order, reload }: TabProps) {
  const { me } = useAuth();
  const [pending, setPending] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const { run, busy, message, setMessage } = useAction();
  if (!me) return null;

  const actions = availableActions(order.state, me.role, { hasTechnician: Boolean(order.technicianId) });
  if (actions.length === 0) return null;
  const rule = pending ? ruleFor(pending) : undefined;

  async function confirm(action: string) {
    const result = await run(() => api(`/work-orders/${order.id}/transitions`, { method: "POST", body: { action, expectedVersion: order.version, reason: reason.trim() || undefined } }), `${ACTION_LABEL[action] ?? action}: feito.`);
    if (result.ok) { setPending(null); setReason(""); reload(); }
    else if (result.error instanceof ApiError && result.error.code === "CONFLITO_DE_VERSAO") reload();
  }

  return (
    <section className="card" aria-labelledby="h-acoes" style={{ marginTop: 16 }}>
      <h2 id="h-acoes">Ações da ordem</h2>
      <div className="actions">
        {actions.map((a) => (
          <button key={a.action} type="button" aria-pressed={pending === a.action} disabled={busy}
            onClick={() => { setPending(pending === a.action ? null : a.action); setReason(""); setMessage(null); }}>
            {ACTION_LABEL[a.action] ?? a.action}
          </button>
        ))}
      </div>
      {pending && rule ? (
        <div style={{ marginTop: 12 }} role="group" aria-label={`Confirmar: ${ACTION_LABEL[pending] ?? pending}`}>
          {rule.reasonRequired ? <TextArea label="Motivo (obrigatório)" value={reason} onChange={setReason} required maxLength={500} /> : null}
          {NEEDS_CONFIRMATION.has(pending) ? <p className="error">Esta ação é difícil de desfazer. Confirme só se tiver certeza.</p> : null}
          <p>
            <button type="button" className="primary" disabled={busy || (rule.reasonRequired && reason.trim().length < 3)} onClick={() => void confirm(pending)}>
              {busy ? "Aplicando…" : `Confirmar: ${ACTION_LABEL[pending] ?? pending}`}
            </button>{" "}
            <button type="button" onClick={() => setPending(null)}>Cancelar</button>
          </p>
        </div>
      ) : null}
      <Message message={message} />
    </section>
  );
}
