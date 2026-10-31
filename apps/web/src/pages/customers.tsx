import { useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, ApiError } from "../api";
import { useAuth } from "../auth";
import { DataTable, Remote } from "../components/parts";
import { CATEGORY_OPTIONS, formatDateTime, formatPhone } from "../format";
import { Message, SelectField, TextArea, TextField, useAction } from "../ui/form";
import { useApi } from "../useApi";

interface Customer { id: string; name: string; phone: string; email: string | null; notes: string | null; createdAt: string }
interface Device { id: string; category: string; brand: string; model: string; color: string | null; serialNumber: string | null; imei: string | null }

export function CustomersPage() {
  const { can } = useAuth();
  const [term, setTerm] = useState("");
  const [applied, setApplied] = useState("");
  const state = useApi<{ customers: Customer[] }>(`/customers?limit=50${applied ? `&q=${encodeURIComponent(applied)}` : ""}`);
  return (
    <>
      <h1>Clientes</h1>
      <form className="actions" role="search" onSubmit={(e) => { e.preventDefault(); setApplied(term.trim()); }}>
        <div style={{ minWidth: 240 }}><TextField label="Buscar por nome ou telefone" value={term} onChange={setTerm} /></div>
        <button type="submit">Buscar</button>
        {can("customer.create") ? <Link className="button primary" to="/clientes/novo" style={{ textDecoration: "none", display: "inline-flex", alignItems: "center" }}>Novo cliente</Link> : null}
      </form>
      <Remote state={state} onRetry={state.reload}>
        {({ customers }) => (
          <DataTable
            caption="Clientes cadastrados"
            rows={customers}
            rowKey={(r) => r.id}
            empty={applied ? "Nenhum cliente encontrado para essa busca." : "Nenhum cliente cadastrado."}
            columns={[
              { header: "Nome", render: (r) => <Link to={`/clientes/${r.id}`}>{r.name}</Link> },
              { header: "Telefone", render: (r) => formatPhone(r.phone) },
              { header: "E-mail", render: (r) => r.email ?? "—" },
              { header: "Cadastro", render: (r) => formatDateTime(r.createdAt) },
            ]}
          />
        )}
      </Remote>
    </>
  );
}

export function CustomerNewPage() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [candidates, setCandidates] = useState<Array<{ id: string; name: string }>>([]);
  const { run, busy, message } = useAction();

  async function submit(event: FormEvent, confirmDuplicate = false) {
    event.preventDefault();
    const result = await run(() => api<Customer>("/customers", { method: "POST", body: { name, phone, email: email || undefined, notes: notes || undefined, confirmDuplicate: confirmDuplicate || undefined } }));
    if (result.ok) navigate(`/clientes/${result.value.id}`);
    else if (result.error instanceof ApiError && result.error.code === "POSSIVEL_DUPLICIDADE") {
      setCandidates((result.error.details as { candidates?: Array<{ id: string; name: string }> } | undefined)?.candidates ?? []);
    }
  }

  return (
    <>
      <p><Link to="/clientes">← Voltar para os clientes</Link></p>
      <h1>Novo cliente</h1>
      <form onSubmit={(e) => void submit(e)} className="card" style={{ maxWidth: 520 }}>
        <TextField label="Nome" value={name} onChange={setName} required autoComplete="name" />
        <TextField label="Telefone com DDD" value={phone} onChange={setPhone} required inputMode="tel" autoComplete="tel" hint="Ex.: (85) 99999-1234" />
        <TextField label="E-mail (opcional)" value={email} onChange={setEmail} type="email" autoComplete="email" />
        <TextArea label="Observações (opcional)" value={notes} onChange={setNotes} />
        <Message message={message} />
        {candidates.length > 0 ? (
          <div role="alert" className="state" style={{ marginTop: 12 }}>
            <p><strong>Já existe cliente com este telefone:</strong></p>
            <ul>{candidates.map((c) => <li key={c.id}><Link to={`/clientes/${c.id}`}>{c.name}</Link></li>)}</ul>
            <p className="muted">Os cadastros não são unidos automaticamente. Use o existente ou confirme que é outra pessoa.</p>
            <button type="button" disabled={busy} onClick={(e) => void submit(e as unknown as FormEvent, true)}>Cadastrar mesmo assim</button>
          </div>
        ) : null}
        <p style={{ marginTop: 16 }}><button type="submit" className="primary" disabled={busy}>{busy ? "Salvando…" : "Salvar cliente"}</button></p>
      </form>
    </>
  );
}

function DeviceForm({ customerId, onSaved }: { customerId: string; onSaved: () => void }) {
  const [category, setCategory] = useState("celular");
  const [brand, setBrand] = useState("");
  const [model, setModel] = useState("");
  const [color, setColor] = useState("");
  const [serial, setSerial] = useState("");
  const [imei, setImei] = useState("");
  const { run, busy, message } = useAction();

  async function submit(event: FormEvent) {
    event.preventDefault();
    const result = await run(() => api(`/customers/${customerId}/devices`, {
      method: "POST",
      body: { category, brand, model, color: color || undefined, serialNumber: serial || undefined, imei: imei || undefined },
    }), "Equipamento cadastrado.");
    if (result.ok) { setBrand(""); setModel(""); setColor(""); setSerial(""); setImei(""); onSaved(); }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="card" style={{ maxWidth: 520 }} aria-labelledby="h-newdev">
      <h2 id="h-newdev">Cadastrar equipamento</h2>
      <SelectField label="Tipo" value={category} onChange={setCategory} options={[...CATEGORY_OPTIONS]} />
      <TextField label="Marca" value={brand} onChange={setBrand} required />
      <TextField label="Modelo" value={model} onChange={setModel} required />
      <TextField label="Cor (opcional)" value={color} onChange={setColor} />
      <TextField label="Número de série (opcional)" value={serial} onChange={setSerial} />
      <TextField label="IMEI (opcional)" value={imei} onChange={setImei} inputMode="numeric" maxLength={15} hint="15 dígitos, com dígito verificador válido." />
      <Message message={message} />
      <p><button type="submit" className="primary" disabled={busy}>Cadastrar equipamento</button></p>
    </form>
  );
}

export function CustomerDetailPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const customer = useApi<Customer>(id ? `/customers/${id}` : null);
  const devices = useApi<{ devices: Device[] }>(id ? `/customers/${id}/devices` : null);
  return (
    <>
      <p><Link to="/clientes">← Voltar para os clientes</Link></p>
      <Remote state={customer} onRetry={customer.reload}>
        {(c) => (
          <>
            <h1>{c.name}</h1>
            <p>{formatPhone(c.phone)}{c.email ? ` · ${c.email}` : ""}</p>
            {c.notes ? <p className="muted">{c.notes}</p> : null}
            {can("work_order.create") ? <p><Link className="button primary" to={`/ordens/nova?clienteId=${c.id}`} style={{ textDecoration: "none", display: "inline-flex", alignItems: "center" }}>Abrir ordem de serviço</Link></p> : null}
            <h2>Equipamentos</h2>
            <Remote state={devices} onRetry={devices.reload}>
              {({ devices: list }) => (
                <>
                  <DataTable
                    caption="Equipamentos do cliente"
                    rows={list}
                    rowKey={(d) => d.id}
                    empty="Nenhum equipamento cadastrado para este cliente."
                    columns={[
                      { header: "Equipamento", render: (d) => `${d.brand} ${d.model}` },
                      { header: "Tipo", render: (d) => d.category },
                      { header: "Série / IMEI", render: (d) => d.serialNumber ?? d.imei ?? "—" },
                      { header: "Ação", render: (d) => (can("work_order.create") ? <Link to={`/ordens/nova?clienteId=${c.id}&equipamentoId=${d.id}`}>Abrir OS</Link> : "—") },
                    ]}
                  />
                  {can("device.create") ? <div style={{ marginTop: 16 }}><DeviceForm customerId={c.id} onSaved={devices.reload} /></div> : null}
                </>
              )}
            </Remote>
          </>
        )}
      </Remote>
    </>
  );
}
