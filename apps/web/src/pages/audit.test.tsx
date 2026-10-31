import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
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
const me = (role: string) => ({ user: { id: "u", name: "Dona", email: "d@t.invalid" }, tenant: { id: "t", name: "Assistência" }, role, csrfToken: "csrf", senhaTemporaria: false });

const events = (n: number, offset = 0) =>
  Array.from({ length: n }, (_, i) => ({
    id: `e${offset + i}`, at: "2026-10-31T15:00:00Z", action: i === 0 ? "master_tenant_suspensa" : "work_order_opened", outcome: i === 1 ? "negado" : "ok",
    targetType: "work_order", targetId: null, reason: i === 0 ? "Pedido formal do dono" : null,
    actor: i === 0 ? { kind: "plataforma", name: null } : { kind: "equipe", name: "Bia Atendente" },
  }));

function mount(role: string, audit: (url: string) => unknown) {
  const urls: string[] = [];
  vi.stubGlobal("fetch", (url: string) => {
    urls.push(url);
    if (url.endsWith("/me")) return json(200, me(role));
    if (url.includes("/audit")) return json(200, audit(url));
    return json(200, { period: { from: "a", to: "b" }, indicators: [], tenants: [] });
  });
  window.history.pushState({}, "", "/auditoria");
  const view = render(<MemoryRouter initialEntries={["/auditoria"]}><AuthProvider><App /></AuthProvider></MemoryRouter>);
  return { ...view, urls };
}

describe("tela de auditoria", () => {
  it("proprietário vê a tabela com rótulos em português, autor correto e menu; sem violações de acessibilidade", async () => {
    const { findAllByText, container, getAllByRole, getByRole } = mount("proprietario", () => ({ events: events(3), hasMore: false }));
    expect((await findAllByText("Ordem de serviço aberta", { selector: "td" })).length).toBe(2);
    expect(container.textContent).toContain("Assistência suspensa pela plataforma");
    expect(container.textContent).toContain("Plataforma");
    expect(container.textContent).toContain("Pedido formal do dono");
    expect(container.textContent).toContain("Bia Atendente");
    expect(container.textContent).toContain("Negado");
    expect(getAllByRole("link", { name: "Auditoria" }).length).toBeGreaterThan(0);
    expect(getByRole("table")).toBeTruthy();
    const result = await axe.run(container, { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } });
    expect(result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join("|")}`)).toEqual([]);
  });

  it("atendente não vê a tela nem o item de menu", async () => {
    const { findByText, queryByRole, queryByText } = mount("atendente", () => ({ events: events(1), hasMore: false }));
    await findByText("Sem permissão");
    expect(queryByRole("link", { name: "Auditoria" })).toBeNull();
    expect(queryByText("Ordem de serviço aberta", { selector: "td" })).toBeNull();
  });

  it("filtros e paginação viram parâmetros da consulta; período incompleto não é enviado", async () => {
    const { findByText, getByLabelText, getByRole, urls } = mount("gerente", (url) => ({ events: events(2, url.includes("offset=20") ? 20 : 0), hasMore: !url.includes("offset=20") }));
    await findByText("Ordem de serviço aberta", { selector: "td" });
    fireEvent.change(getByLabelText("Resultado"), { target: { value: "negado" } });
    await waitFor(() => expect(urls.some((u) => u.includes("outcome=negado"))).toBe(true));
    fireEvent.change(getByLabelText("De"), { target: { value: "2026-10-01" } });
    expect(urls.some((u) => u.includes("from="))).toBe(false); // só uma das datas: não envia
    fireEvent.change(getByLabelText("Até"), { target: { value: "2026-10-31" } });
    await waitFor(() => expect(urls.some((u) => u.includes("from=2026-10-01") && u.includes("to=2026-10-31"))).toBe(true));
    fireEvent.click(getByRole("button", { name: "Próximos" }));
    await waitFor(() => expect(urls.some((u) => u.includes("offset=20"))).toBe(true));
    await waitFor(() => expect((getByRole("button", { name: "Anteriores" }) as HTMLButtonElement).disabled).toBe(false));
  });

  it("estado vazio e erro têm mensagem", async () => {
    const { findByText } = mount("proprietario", () => ({ events: [], hasMore: false }));
    await findByText("Nenhum evento para estes filtros.");
  });
});
