import { useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { Remote } from "../components/parts";
import { formatPhone } from "../format";
import { Message, SelectField, TextArea, TextField, useAction } from "../ui/form";
import { useApi } from "../useApi";

interface Customer { id: string; name: string; phone: string }
interface Device { id: string; category: string; brand: string; model: string; serialNumber: string | null }

const RESULTS = [
  { value: "nao_testado", label: "Não testado" }, { value: "funcionando", label: "Funcionando" },
  { value: "com_defeito", label: "Com defeito" }, { value: "nao_aplicavel", label: "Não se aplica" },
] as const;
type Result = (typeof RESULTS)[number]["value"];
const DEFAULT_ITEMS = ["Tela", "Touch", "Câmeras", "Áudio", "Carga", "Botões", "Wi-Fi"];
const PRIORITIES = [{ value: "normal", label: "Normal" }, { value: "baixa", label: "Baixa" }, { value: "alta", label: "Alta" }, { value: "urgente", label: "Urgente" }] as const;

export function OrderNewPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [customerId, setCustomerId] = useState(params.get("clienteId") ?? "");
  const [deviceId, setDeviceId] = useState(params.get("equipamentoId") ?? "");
  const [term, setTerm] = useState("");
  const [applied, setApplied] = useState("");
  const [defect, setDefect] = useState("");
  const [priority, setPriority] = useState<(typeof PRIORITIES)[number]["value"]>("normal");
  const [technicianId, setTechnicianId] = useState("");
  const [condition, setCondition] = useState("");
  const [accessories, setAccessories] = useState("");
  const [passwordInformed, setPasswordInformed] = useState(false);
  const [checklist, setChecklist] = useState<Record<string, Result>>(() => Object.fromEntries(DEFAULT_ITEMS.map((i) => [i, "nao_testado" as Result])));
  // Uma chave por abertura de formulário: se o clique for repetido ou a rede cair, a mesma OS volta (sem duplicar).
  const idempotencyKey = useRef(crypto.randomUUID());
  const { run, busy, message } = useAction();

  const customers = useApi<{ customers: Customer[] }>(!customerId && applied ? `/customers?limit=10&q=${encodeURIComponent(applied)}` : null);
  const customer = useApi<Customer>(customerId ? `/customers/${customerId}` : null);
  const devices = useApi<{ devices: Device[] }>(customerId ? `/customers/${customerId}/devices` : null);
  const technicians = useApi<{ technicians: Array<{ id: string; name: string }> }>("/technicians");

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!deviceId) return;
    const result = await run(() => api<{ id: string; protocol: string }>("/work-orders", {
      method: "POST",
      headers: { "idempotency-key": idempotencyKey.current },
      body: {
        customerId, deviceId, reportedDefect: defect, priority, technicianId: technicianId || undefined,
        inspection: {
          physicalCondition: condition,
          accessories: accessories.split(",").map((a) => a.trim()).filter(Boolean),
          checklist: Object.entries(checklist).map(([item, resultValue]) => ({ item, result: resultValue })),
          passwordInformed,
        },
      },
    }));
    if (result.ok) navigate(`/ordens/${result.value.id}`);
  }

  return (
    <>
      <p><Link to="/ordens">← Voltar para as ordens</Link></p>
      <h1>Nova ordem de serviço</h1>
      <form onSubmit={(e) => void submit(e)} style={{ maxWidth: 640 }}>
        <section className="card" aria-labelledby="h-cliente">
          <h2 id="h-cliente">1. Cliente</h2>
          {customerId ? (
            <Remote state={customer} onRetry={customer.reload}>
              {(c) => (
                <p><strong>{c.name}</strong> · {formatPhone(c.phone)} <button type="button" onClick={() => { setCustomerId(""); setDeviceId(""); }}>Trocar cliente</button></p>
              )}
            </Remote>
          ) : (
            <>
              <div className="actions">
                <div style={{ minWidth: 240 }}><TextField label="Buscar cliente por nome ou telefone" value={term} onChange={setTerm} /></div>
                <button type="button" onClick={() => setApplied(term.trim())}>Buscar</button>
                <Link to="/clientes/novo">Cadastrar novo cliente</Link>
              </div>
              {applied ? (
                <Remote state={customers} onRetry={customers.reload}>
                  {({ customers: list }) => (list.length === 0 ? <p className="muted">Nenhum cliente encontrado.</p> : (
                    <ul style={{ listStyle: "none", padding: 0 }}>
                      {list.map((c) => <li key={c.id}><button type="button" onClick={() => setCustomerId(c.id)}>Usar {c.name} ({formatPhone(c.phone)})</button></li>)}
                    </ul>
                  ))}
                </Remote>
              ) : null}
            </>
          )}
        </section>

        {customerId ? (
          <section className="card" aria-labelledby="h-eq" style={{ marginTop: 16 }}>
            <h2 id="h-eq">2. Equipamento</h2>
            <Remote state={devices} onRetry={devices.reload}>
              {({ devices: list }) => (list.length === 0 ? (
                <p>Este cliente ainda não tem equipamento. <Link to={`/clientes/${customerId}`}>Cadastre o equipamento</Link> e volte.</p>
              ) : (
                <fieldset style={{ border: 0, padding: 0 }}>
                  <legend className="muted">Escolha o equipamento recebido</legend>
                  {list.map((d) => (
                    <label key={d.id} style={{ fontWeight: 400, display: "flex", gap: 8, alignItems: "center", minHeight: 44 }}>
                      <input type="radio" name="device" style={{ width: "auto", minHeight: 0 }} checked={deviceId === d.id} onChange={() => setDeviceId(d.id)} />
                      {d.brand} {d.model} ({d.category}){d.serialNumber ? ` · série ${d.serialNumber}` : ""}
                    </label>
                  ))}
                </fieldset>
              ))}
            </Remote>
          </section>
        ) : null}

        {customerId && deviceId ? (
          <>
            <section className="card" aria-labelledby="h-rec" style={{ marginTop: 16 }}>
              <h2 id="h-rec">3. Recebimento</h2>
              <TextArea label="Defeito relatado pelo cliente" value={defect} onChange={setDefect} required maxLength={2000} />
              <TextArea label="Estado físico do aparelho" value={condition} onChange={setCondition} required hint="Riscos, trincas, amassados, marcas de líquido." />
              <TextField label="Acessórios recebidos" value={accessories} onChange={setAccessories} hint="Separe por vírgula. Ex.: carregador, capa" />
              <label style={{ fontWeight: 400, display: "flex", gap: 8, alignItems: "center", minHeight: 44 }}>
                <input type="checkbox" style={{ width: "auto", minHeight: 0 }} checked={passwordInformed} onChange={(e) => setPasswordInformed(e.target.checked)} />
                O cliente informou a senha do aparelho (a senha não é registrada)
              </label>
              <fieldset style={{ border: 0, padding: 0, marginTop: 8 }}>
                <legend><strong>Checklist de entrada</strong></legend>
                <p className="muted">O que não foi testado fica como "Não testado". Nunca marque como funcionando o que não foi testado.</p>
                {DEFAULT_ITEMS.map((item) => (
                  <SelectField key={item} label={item} value={checklist[item] ?? "nao_testado"} onChange={(value) => setChecklist((current) => ({ ...current, [item]: value }))} options={[...RESULTS]} />
                ))}
              </fieldset>
            </section>
            <section className="card" aria-labelledby="h-det" style={{ marginTop: 16 }}>
              <h2 id="h-det">4. Detalhes</h2>
              <SelectField label="Prioridade" value={priority} onChange={setPriority} options={[...PRIORITIES]} />
              <Remote state={technicians} onRetry={technicians.reload}>
                {({ technicians: list }) => (
                  <SelectField
                    label="Técnico (opcional)"
                    value={technicianId}
                    onChange={setTechnicianId}
                    options={[{ value: "", label: "Atribuir depois" }, ...list.map((t) => ({ value: t.id, label: t.name }))]}
                  />
                )}
              </Remote>
            </section>
            <Message message={message} />
            <p style={{ marginTop: 16 }}><button type="submit" className="primary" disabled={busy || !defect.trim() || !condition.trim()}>{busy ? "Abrindo…" : "Abrir ordem de serviço"}</button></p>
          </>
        ) : null}
      </form>
    </>
  );
}
