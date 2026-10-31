import { cleanup, fireEvent, render } from "@testing-library/react";
import axe from "axe-core";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../App";
import { AuthProvider } from "../auth";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const json = (status: number, body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
const me = (senhaTemporaria: boolean) => ({
  user: { id: "u", name: "Dona", email: "d@t.invalid" }, tenant: { id: "t", name: "Assistência" }, role: "proprietario", csrfToken: "csrf-1", senhaTemporaria,
});

function mount() {
  return render(<MemoryRouter><AuthProvider><App /></AuthProvider></MemoryRouter>);
}

describe("senha temporária no primeiro acesso", () => {
  it("mostra só a troca de senha, sem o menu do sistema, e não tem violações de acessibilidade", async () => {
    vi.stubGlobal("fetch", () => json(200, me(true)));
    const { findByRole, queryByRole, container } = mount();
    await findByRole("heading", { name: "Defina sua senha" });
    expect(queryByRole("navigation")).toBeNull();
    const result = await axe.run(container, { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } });
    expect(result.violations.map((v) => v.id)).toEqual([]);
  });

  it("confere a confirmação antes de enviar; enviada, manda a senha atual e a nova e libera o sistema", async () => {
    let temporary = true;
    const calls: Array<[string, RequestInit | undefined]> = [];
    vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
      calls.push([url, init]);
      if (url.endsWith("/auth/change-password")) { temporary = false; return Promise.resolve(new Response(null, { status: 204 })); }
      if (url.endsWith("/me")) return json(200, me(temporary));
      // Depois da troca o app abre o Dashboard: precisa de uma resposta no formato real (antes `{}` quebrava a tela).
      if (url.includes("/dashboard")) return json(200, { period: { from: "2026-10-01", to: "2026-10-31", timezone: "America/Sao_Paulo", startUtc: "", endExclusiveUtc: "" }, generatedAt: "2026-10-31T12:00:00Z", indicators: [] });
      return json(200, {});
    });
    const { findByLabelText, getByLabelText, getByRole, findByRole } = mount();
    fireEvent.change(await findByLabelText("Senha temporária"), { target: { value: "temporaria-xyz-123" } });
    fireEvent.change(getByLabelText("Nova senha"), { target: { value: "minha-senha-nova-segura" } });
    fireEvent.change(getByLabelText("Repita a nova senha"), { target: { value: "diferente-diferente-1" } });
    fireEvent.click(getByRole("button", { name: "Salvar nova senha" }));
    expect((await findByRole("alert")).textContent).toContain("não confere");
    expect(calls.some(([url]) => url.endsWith("/auth/change-password"))).toBe(false);

    fireEvent.change(getByLabelText("Repita a nova senha"), { target: { value: "minha-senha-nova-segura" } });
    fireEvent.click(getByRole("button", { name: "Salvar nova senha" }));
    await vi.waitFor(() => expect(calls.some(([url]) => url.endsWith("/auth/change-password"))).toBe(true));
    const change = calls.find(([url]) => url.endsWith("/auth/change-password"));
    expect(JSON.parse(String(change?.[1]?.body))).toEqual({ currentPassword: "temporaria-xyz-123", newPassword: "minha-senha-nova-segura" });
    expect(JSON.stringify(change?.[1]?.headers)).toContain("csrf-1");
    await vi.waitFor(() => expect(document.body.textContent).not.toContain("Defina sua senha"));
  });

  it("conta normal não vê a tela de troca", async () => {
    // O app abre o Dashboard depois de entrar: o mock precisa devolver o formato real (resposta com o objeto de /me quebrava a tela, de forma intermitente).
    vi.stubGlobal("fetch", (url: string) => (url.includes("/dashboard")
      ? json(200, { period: { from: "2026-10-01", to: "2026-10-31" }, generatedAt: "2026-10-31T12:00:00Z", indicators: [] })
      : json(200, me(false))));
    const { queryByRole, findAllByRole } = mount();
    await findAllByRole("navigation");
    expect(queryByRole("heading", { name: "Defina sua senha" })).toBeNull();
  });
});
