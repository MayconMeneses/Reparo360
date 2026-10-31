import { canManageMember, TENANT_ROLES, type TenantRole } from "@reparo360/domain";
import { useState, type FormEvent } from "react";
import { api, ApiError } from "../api";
import { useAuth } from "../auth";
import { DataTable, Remote } from "../components/parts";
import { ROLE_LABEL } from "../format";
import { Message, SelectField, TextField, useAction } from "../ui/form";
import { useAuthOptions } from "../authOptions";
import { useApi } from "../useApi";

interface Member { userId: string; name: string; email: string; role: TenantRole; status: string }

const NEED_REAUTH = "REAUTENTICACAO_NECESSARIA";
const isReauth = (error: unknown) => error instanceof ApiError && error.code === NEED_REAUTH;

/** Operações de equipe exigem senha recente. Pede a senha e, se correta, o servidor renova a janela. */
function ReauthPrompt({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState("");
  const { run, busy, message } = useAction();
  async function submit(event: FormEvent) {
    event.preventDefault();
    const result = await run(() => api("/auth/reauth", { method: "POST", body: { password } }));
    if (result.ok) { setPassword(""); onDone(); }
  }
  return (
    <form onSubmit={(e) => void submit(e)} className="card" style={{ maxWidth: 420 }} aria-labelledby="h-reauth">
      <h2 id="h-reauth">Confirme sua senha</h2>
      <p className="muted">Por segurança, a gestão da equipe pede a sua senha de novo.</p>
      <TextField label="Sua senha" type="password" value={password} onChange={setPassword} required autoComplete="current-password" />
      <Message message={message} />
      <p><button type="submit" className="primary" disabled={busy || password.length === 0}>Confirmar</button></p>
    </form>
  );
}

function NewMemberForm({ allowed, onSaved, onNeedReauth }: { allowed: TenantRole[]; onSaved: () => void; onNeedReauth: () => void }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<TenantRole>(allowed[0] ?? "atendente");
  const [invite, setInvite] = useState(false);
  const options = useAuthOptions();
  const { run, busy, message } = useAction();

  async function submit(event: FormEvent) {
    event.preventDefault();
    const body = invite ? { name, email, role, inviteByEmail: true } : { name, email, password, role };
    const result = await run(() => api("/team/members", { method: "POST", body }), invite ? "Convite enviado por e-mail." : "Membro cadastrado.");
    if (result.ok) { setName(""); setEmail(""); setPassword(""); onSaved(); }
    else if (isReauth(result.error)) onNeedReauth();
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="card" style={{ maxWidth: 520, marginTop: 16 }} aria-labelledby="h-novo-membro">
      <h2 id="h-novo-membro">Cadastrar membro</h2>
      <TextField label="Nome" value={name} onChange={setName} required autoComplete="off" />
      <TextField label="E-mail" type="email" value={email} onChange={setEmail} required autoComplete="off" />
      {options.passwordReset ? (
        <p>
          <label>
            <input type="checkbox" checked={invite} onChange={(e) => setInvite(e.target.checked)} /> Enviar convite por e-mail (a pessoa escolhe a própria senha)
          </label>
        </p>
      ) : null}
      {invite ? (
        <p className="muted">A pessoa recebe um link por e-mail (vale 72 horas) para definir a senha. Você não vê nem escolhe a senha.</p>
      ) : (
        <TextField label="Senha inicial" type="password" value={password} onChange={setPassword} required autoComplete="new-password"
          hint={options.passwordReset ? "Mínimo de 12 caracteres. Entregue ao membro em pessoa, ou use o convite por e-mail." : "Mínimo de 12 caracteres. Entregue ao membro em pessoa; ele deve guardá-la. O convite por e-mail precisa do envio de e-mail configurado."} />
      )}
      <SelectField label="Função" value={role} onChange={setRole} options={allowed.map((r) => ({ value: r, label: ROLE_LABEL[r] ?? r }))} />
      <Message message={message} />
      <p><button type="submit" className="primary" disabled={busy}>{busy ? "Salvando…" : invite ? "Enviar convite" : "Cadastrar membro"}</button></p>
    </form>
  );
}

function MemberRow({ member, me, onChanged, onNeedReauth }: { member: Member; me: { userId: string; role: TenantRole }; onChanged: () => void; onNeedReauth: () => void }) {
  const [role, setRole] = useState<TenantRole>(member.role);
  const { run, busy, message } = useAction();
  const isSelf = member.userId === me.userId;
  const editable = !isSelf && canManageMember(me.role, member.role);
  const roles = TENANT_ROLES.filter((r) => canManageMember(me.role, member.role, r));
  const active = member.status === "ativo";

  async function change(body: { role?: TenantRole; status?: "ativo" | "desativado" }, okText: string) {
    const result = await run(() => api(`/team/members/${member.userId}`, { method: "PATCH", body }), okText);
    if (result.ok) onChanged();
    else if (isReauth(result.error)) onNeedReauth();
  }

  if (!editable) return <span className="muted">{isSelf ? "Você" : "—"}</span>;
  return (
    <div>
      <div className="actions">
        <label htmlFor={`role-${member.userId}`} className="skip-link" style={{ position: "static", left: "auto" }}>Função de {member.name}</label>
        <select id={`role-${member.userId}`} value={role} style={{ width: "auto" }} onChange={(e) => setRole(e.target.value as TenantRole)}>
          {roles.map((r) => <option key={r} value={r}>{ROLE_LABEL[r] ?? r}</option>)}
        </select>
        <button type="button" disabled={busy || role === member.role} onClick={() => void change({ role }, "Função alterada.")}>Salvar função</button>
        <button type="button" disabled={busy} onClick={() => { if (window.confirm(active ? `Desativar ${member.name}? O acesso é encerrado agora.` : `Reativar ${member.name}?`)) void change({ status: active ? "desativado" : "ativo" }, active ? "Membro desativado." : "Membro reativado."); }}>
          {active ? "Desativar" : "Reativar"}
        </button>
      </div>
      <Message message={message} />
    </div>
  );
}

export function TeamPage() {
  const { me, can } = useAuth();
  const [reauth, setReauth] = useState(false);
  const state = useApi<{ members: Member[] }>(can("team.manage") && !reauth ? "/team" : null);
  if (!me || !can("team.manage")) return <p className="state">Você não tem permissão para gerir a equipe.</p>;

  const needsReauth = reauth || (state.status === "error" && state.code === NEED_REAUTH);
  const allowedRoles = TENANT_ROLES.filter((r) => canManageMember(me.role, "atendente", r));
  const afterReauth = () => { setReauth(false); state.reload(); };

  return (
    <>
      <h1>Equipe</h1>
      {needsReauth ? <ReauthPrompt onDone={afterReauth} /> : (
        <>
          <Remote state={state} onRetry={state.reload}>
            {({ members }) => (
              <DataTable
                caption="Membros da equipe"
                rows={members}
                rowKey={(m) => m.userId}
                empty="Nenhum membro."
                columns={[
                  { header: "Nome", render: (m) => m.name },
                  { header: "E-mail", render: (m) => m.email },
                  { header: "Função", render: (m) => ROLE_LABEL[m.role] ?? m.role },
                  { header: "Situação", render: (m) => (m.status === "ativo" ? "Ativo" : "Desativado") },
                  { header: "Ações", render: (m) => <MemberRow member={m} me={{ userId: me.user.id, role: me.role }} onChanged={state.reload} onNeedReauth={() => setReauth(true)} /> },
                ]}
              />
            )}
          </Remote>
          <NewMemberForm allowed={allowedRoles} onSaved={state.reload} onNeedReauth={() => setReauth(true)} />
        </>
      )}
    </>
  );
}
