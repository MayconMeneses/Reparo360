import { useCallback, useEffect, useState, type FormEvent } from "react";
import { formatDateTime } from "../format";
import { Message, TextArea, TextField } from "../ui/form";
import { masterApi, MasterApiError, TENANT_STATUS_LABEL, type TenantRow } from "./masterApi";

type Notice = { kind: "ok" | "error"; text: string } | null;

/** Empresas: situação e contagens. Nunca dados de clientes. Suspender/reativar pede motivo e um código novo. */
export function TenantsPanel({ onSessionLost }: { onSessionLost: () => void }) {
  const [tenants, setTenants] = useState<TenantRow[] | null>(null);
  const [target, setTarget] = useState<{ tenant: TenantRow; status: "ativa" | "suspensa" } | null>(null);
  const [reason, setReason] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  const load = useCallback(async () => {
    try {
      setTenants((await masterApi<{ tenants: TenantRow[] }>("/tenants")).tenants);
    } catch (error) {
      if (error instanceof MasterApiError && error.status === 401) onSessionLost();
      else setNotice({ kind: "error", text: "Não foi possível carregar as empresas." });
    }
  }, [onSessionLost]);

  useEffect(() => { void load(); }, [load]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!target) return;
    setBusy(true);
    setNotice(null);
    try {
      await masterApi("/auth/reauth", { method: "POST", body: { code } });
      await masterApi(`/tenants/${target.tenant.id}/status`, { method: "POST", body: { status: target.status, reason } });
      setNotice({ kind: "ok", text: `${target.tenant.name}: situação alterada para ${TENANT_STATUS_LABEL[target.status]}.` });
      setTarget(null);
      setReason("");
      await load();
    } catch (error) {
      if (error instanceof MasterApiError && error.status === 401 && error.code === "NAO_AUTENTICADO") onSessionLost();
      else setNotice({ kind: "error", text: error instanceof MasterApiError ? error.message : "Não foi possível concluir." });
    } finally {
      setCode("");
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="m-tenants">
      <h2 id="m-tenants">Assistências</h2>
      <Message message={notice} />
      {tenants === null ? <p role="status" className="state">Carregando…</p> : (
        <div className="table-wrap">
          <table>
            <caption>Empresas cadastradas (somente situação e contagens)</caption>
            <thead>
              <tr><th scope="col">Empresa</th><th scope="col">Situação</th><th scope="col">Membros ativos</th><th scope="col">Ordens</th><th scope="col">Criada em</th><th scope="col">Ação</th></tr>
            </thead>
            <tbody>
              {tenants.map((t) => (
                <tr key={t.id}>
                  <td>{t.tradeName ?? t.name}</td>
                  <td><span className="badge">{TENANT_STATUS_LABEL[t.status] ?? t.status}</span></td>
                  <td>{t.activeMembers}</td>
                  <td>{t.workOrders}</td>
                  <td>{formatDateTime(t.createdAt)}</td>
                  <td>
                    {t.status === "suspensa" ? (
                      <button type="button" aria-label={`Reativar ${t.name}`} onClick={() => setTarget({ tenant: t, status: "ativa" })}>Reativar</button>
                    ) : t.status !== "cancelada" ? (
                      <button type="button" aria-label={`Suspender ${t.name}`} onClick={() => setTarget({ tenant: t, status: "suspensa" })}>Suspender</button>
                    ) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {target ? (
        <form onSubmit={(event) => void submit(event)} className="card" aria-labelledby="m-confirm" style={{ marginTop: 16 }}>
          <h3 id="m-confirm">{target.status === "suspensa" ? "Suspender" : "Reativar"} {target.tenant.name}</h3>
          {target.status === "suspensa" ? <p>Quem trabalha nesta assistência perde o acesso imediatamente.</p> : null}
          <TextArea label="Motivo (fica registrado na trilha da empresa)" value={reason} onChange={setReason} required rows={3} maxLength={300} />
          <TextField label="Código novo do autenticador" value={code} onChange={(value) => setCode(value.replace(/\D/g, "").slice(0, 6))} required inputMode="numeric" maxLength={6} autoComplete="one-time-code" hint="Espere o código mudar se já usou este para entrar." />
          <div className="actions">
            <button type="submit" className="primary" disabled={busy || reason.trim().length < 5 || code.length !== 6}>Confirmar</button>
            <button type="button" disabled={busy} onClick={() => setTarget(null)}>Cancelar</button>
          </div>
        </form>
      ) : null}
    </section>
  );
}
