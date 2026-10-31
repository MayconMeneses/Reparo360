import { useState, type FormEvent } from "react";
import { Message, TextField } from "../ui/form";
import { masterApi, MasterApiError } from "./masterApi";

interface Created { tenantId: string; ownerEmail: string; temporaryPassword: string }

/**
 * Nova assistência. O Master não escolhe senha: o servidor gera uma temporária, mostrada UMA vez aqui, e o
 * proprietário é obrigado a trocá-la no primeiro acesso. A entrega da senha é por fora do sistema.
 */
export function NewTenantForm({ onCreated, onSessionLost }: { onCreated: () => void; onSessionLost: () => void }) {
  const [open, setOpen] = useState(false);
  const [tenantName, setTenantName] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<Created | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await masterApi("/auth/reauth", { method: "POST", body: { code } });
      setCreated(await masterApi<Created>("/tenants", { method: "POST", body: { tenantName, ownerName, ownerEmail } }));
      setTenantName(""); setOwnerName(""); setOwnerEmail(""); setOpen(false);
      onCreated();
    } catch (caught) {
      if (caught instanceof MasterApiError && caught.code === "NAO_AUTENTICADO") onSessionLost();
      else setError(caught instanceof MasterApiError ? caught.message : "Não foi possível concluir.");
    } finally {
      setCode("");
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="m-new" style={{ marginBottom: 16 }}>
      <h2 id="m-new">Nova assistência</h2>
      {created ? (
        <div role="status" className="card">
          <p><strong>Assistência criada.</strong> Entregue estes dados ao proprietário por um meio seguro. A senha <strong>não será mostrada de novo</strong>.</p>
          <p>E-mail: <code>{created.ownerEmail}</code></p>
          <p>Senha temporária: <code>{created.temporaryPassword}</code></p>
          <p className="muted">No primeiro acesso ele será obrigado a trocar a senha.</p>
          <p><button type="button" onClick={() => setCreated(null)}>Já anotei, fechar</button></p>
        </div>
      ) : null}
      {!open ? <p><button type="button" onClick={() => setOpen(true)}>Criar assistência</button></p> : (
        <form onSubmit={(event) => void submit(event)} className="card" aria-label="Dados da nova assistência">
          <TextField label="Nome da assistência" value={tenantName} onChange={setTenantName} required maxLength={120} />
          <TextField label="Nome do proprietário" value={ownerName} onChange={setOwnerName} required maxLength={120} />
          <TextField label="E-mail do proprietário" type="email" value={ownerEmail} onChange={setOwnerEmail} required maxLength={254} />
          <TextField label="Código novo do autenticador" value={code} onChange={(value) => setCode(value.replace(/\D/g, "").slice(0, 6))} required inputMode="numeric" maxLength={6} autoComplete="one-time-code" hint="Espere o código mudar se já usou este para entrar." />
          <div className="actions">
            <button type="submit" className="primary" disabled={busy || tenantName.trim().length < 2 || ownerName.trim().length < 2 || !ownerEmail || code.length !== 6}>Criar</button>
            <button type="button" disabled={busy} onClick={() => setOpen(false)}>Cancelar</button>
          </div>
          <Message message={error ? { kind: "error", text: error } : null} />
        </form>
      )}
    </section>
  );
}
