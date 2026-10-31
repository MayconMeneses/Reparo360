import { useEffect, useState, type FormEvent } from "react";
import { api, ApiError } from "../api";
import { Remote } from "../components/parts";
import { useApi } from "../useApi";

interface Tenant { name: string; tradeName: string | null; phone: string | null; adminEmail: string }

function Form({ tenant, onSaved }: { tenant: Tenant; onSaved: () => void }) {
  const [name, setName] = useState(tenant.name);
  const [tradeName, setTradeName] = useState(tenant.tradeName ?? "");
  const [phone, setPhone] = useState(tenant.phone ?? "");
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  useEffect(() => { setName(tenant.name); setTradeName(tenant.tradeName ?? ""); setPhone(tenant.phone ?? ""); }, [tenant]);

  async function save(event: FormEvent) {
    event.preventDefault();
    setMessage(null);
    try {
      await api("/tenant", { method: "PATCH", body: { name, tradeName: tradeName || null, phone: phone || null } });
      setMessage({ kind: "ok", text: "Dados salvos." });
      onSaved();
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof ApiError ? error.message : "Falha de conexão." });
    }
  }

  return (
    <form onSubmit={save} className="card" style={{ maxWidth: 520 }}>
      <label htmlFor="name">Nome da assistência</label>
      <input id="name" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} />
      <label htmlFor="trade">Nome comercial</label>
      <input id="trade" value={tradeName} onChange={(e) => setTradeName(e.target.value)} />
      <label htmlFor="phone">Telefone de contato (aparece para o cliente)</label>
      <input id="phone" value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" />
      <p className="muted">E-mail administrativo: {tenant.adminEmail}</p>
      {message ? <p role={message.kind === "error" ? "alert" : "status"} className={message.kind === "error" ? "error" : undefined}>{message.text}</p> : null}
      <button type="submit" className="primary">Salvar</button>
    </form>
  );
}

export function SettingsPage() {
  const state = useApi<Tenant>("/tenant");
  return (
    <>
      <h1>Configurações</h1>
      <Remote state={state} onRetry={state.reload}>{(tenant) => <Form tenant={tenant} onSaved={state.reload} />}</Remote>
    </>
  );
}
