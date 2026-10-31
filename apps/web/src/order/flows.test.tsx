import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import axe from "axe-core";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setCsrfToken } from "../api";
import { AuthProvider } from "../auth";
import { CustomerNewPage } from "../pages/customers";
import { Tabs } from "../ui/tabs";
import { QuoteEditor } from "./QuoteEditor";
import type { OrderDetail } from "./types";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); setCsrfToken(null); });

const json = (status: number, body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
const me = { user: { id: "u", name: "Dono", email: "d@t.invalid" }, tenant: { id: "t", name: "Loja" }, role: "proprietario", csrfToken: "csrf-teste" };

const order = {
  id: "o1", protocol: "2026-000001", state: "EM_DIAGNOSTICO", diagnostics: [{ nature: "confirmado" }], quotes: [], attachments: [], events: [],
} as unknown as OrderDetail;

/** fetch falso: registra as chamadas e responde conforme a rota. */
function mockApi(routes: Record<string, (init: RequestInit) => Promise<Response>>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  vi.stubGlobal("fetch", (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    const key = `${init.method ?? "GET"} ${url}`;
    const handler = routes[key];
    return handler ? handler(init) : json(404, { error: { code: "X", message: "sem rota" } });
  });
  return calls;
}

describe("orçamento: dinheiro digitado vira centavos inteiros no envio", () => {
  it("envia '150,00' e '45,90' como 15000 e 4590, e o desconto '10,00' como 1000", async () => {
    const calls = mockApi({
      "GET /api/v1/me": () => json(200, me),
      "POST /api/v1/work-orders/o1/quotes": () => json(201, { id: "q1", revision: 2, number: 1, state: "rascunho", items: [] }),
    });
    render(<MemoryRouter><AuthProvider><QuoteEditor order={order} draft={null} reload={() => undefined} /></AuthProvider></MemoryRouter>);
    await waitFor(() => expect(calls.some((c) => c.url === "/api/v1/me")).toBe(true));

    fireEvent.change(screen.getByLabelText("Descrição"), { target: { value: "Bateria" } });
    fireEvent.change(screen.getByLabelText("Preço unit. (R$)"), { target: { value: "150,00" } });
    fireEvent.click(screen.getByRole("button", { name: "Adicionar item" }));
    const descriptions = screen.getAllByLabelText("Descrição");
    fireEvent.change(descriptions[1] as HTMLElement, { target: { value: "Mão de obra" } });
    fireEvent.change(screen.getAllByLabelText("Qtd.")[1] as HTMLElement, { target: { value: "2" } });
    fireEvent.change(screen.getAllByLabelText("Preço unit. (R$)")[1] as HTMLElement, { target: { value: "45,90" } });
    fireEvent.change(screen.getByLabelText("Desconto (R$)"), { target: { value: "10,00" } });
    fireEvent.change(screen.getByLabelText("Condições de pagamento"), { target: { value: "À vista" } });

    expect(screen.getByText(/subtotal R\$ 241,80/).textContent).toContain("total R$ 231,80");
    fireEvent.click(screen.getByRole("button", { name: "Salvar rascunho" }));
    await waitFor(() => expect(calls.some((c) => c.init.method === "POST" && c.url.endsWith("/quotes"))).toBe(true));
    const sent = JSON.parse(String(calls.find((c) => c.url.endsWith("/quotes"))?.init.body));
    expect(sent.items).toEqual([
      { kind: "servico", description: "Bateria", quantity: 1, unitPriceCents: 15000 },
      { kind: "servico", description: "Mão de obra", quantity: 2, unitPriceCents: 4590 },
    ]);
    expect(sent.discountCents).toBe(1000);
    expect(sent).not.toHaveProperty("totalCents"); // o total nunca é enviado: o servidor calcula
    expect((calls.find((c) => c.url.endsWith("/quotes"))?.init.headers as Record<string, string>)["x-csrf-token"]).toBe("csrf-teste");
  });

  it("preço inválido não é enviado: mostra o erro e não chama a API", async () => {
    const calls = mockApi({ "GET /api/v1/me": () => json(200, me) });
    render(<MemoryRouter><AuthProvider><QuoteEditor order={order} draft={null} reload={() => undefined} /></AuthProvider></MemoryRouter>);
    fireEvent.change(screen.getByLabelText("Descrição"), { target: { value: "Peça" } });
    fireEvent.change(screen.getByLabelText("Preço unit. (R$)"), { target: { value: "12.5" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar rascunho" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Confira os itens");
    expect(calls.filter((c) => c.init.method === "POST")).toHaveLength(0);
  });
});

describe("novo cliente: possível duplicidade", () => {
  it("avisa quem já existe e só cadastra com a confirmação explícita", async () => {
    let attempts = 0;
    const calls = mockApi({
      "GET /api/v1/me": () => json(200, me),
      "POST /api/v1/customers": () => (++attempts === 1
        ? json(409, { error: { code: "POSSIVEL_DUPLICIDADE", message: "Já existe cliente com este telefone.", details: { candidates: [{ id: "c9", name: "Maria Antiga" }] } } })
        : json(201, { id: "c10", name: "Maria", phone: "85999991234" })),
    });
    render(<MemoryRouter><AuthProvider><CustomerNewPage /></AuthProvider></MemoryRouter>);
    fireEvent.change(screen.getByLabelText("Nome"), { target: { value: "Maria" } });
    fireEvent.change(screen.getByLabelText("Telefone com DDD"), { target: { value: "(85) 99999-1234" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar cliente" }));
    const alert = await screen.findByText(/Já existe cliente com este telefone:/);
    expect(within(alert.closest("div") as HTMLElement).getByRole("link", { name: "Maria Antiga" })).toBeTruthy();
    expect(JSON.parse(String(calls.find((c) => c.url === "/api/v1/customers")?.init.body))).not.toHaveProperty("confirmDuplicate");

    fireEvent.click(screen.getByRole("button", { name: "Cadastrar mesmo assim" }));
    await waitFor(() => expect(attempts).toBe(2));
    const second = JSON.parse(String(calls.filter((c) => c.url === "/api/v1/customers")[1]?.init.body));
    expect(second.confirmDuplicate).toBe(true);
  });

  it("clique duplo no salvar envia uma única requisição", async () => {
    const calls = mockApi({
      "GET /api/v1/me": () => json(200, me),
      "POST /api/v1/customers": () => new Promise((resolve) => setTimeout(() => resolve(new Response(JSON.stringify({ id: "c1" }), { status: 201, headers: { "content-type": "application/json" } })), 50)),
    });
    render(<MemoryRouter><AuthProvider><CustomerNewPage /></AuthProvider></MemoryRouter>);
    fireEvent.change(screen.getByLabelText("Nome"), { target: { value: "Maria" } });
    fireEvent.change(screen.getByLabelText("Telefone com DDD"), { target: { value: "85999991234" } });
    const button = screen.getByRole("button", { name: "Salvar cliente" });
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(calls.filter((c) => c.init.method === "POST")).toHaveLength(1));
  });
});

describe("abas acessíveis", () => {
  const tabs = [{ id: "a", label: "Resumo" }, { id: "b", label: "Diagnóstico" }, { id: "c", label: "Testes" }];

  it("setas, Home e End movem a seleção e o foco; só a aba ativa é tabulável", () => {
    const onChange = vi.fn();
    const { rerender } = render(<Tabs tabs={tabs} active="a" onChange={onChange}><p>conteúdo</p></Tabs>);
    const tablist = screen.getByRole("tablist");
    const items = within(tablist).getAllByRole("tab");
    expect(items.map((t) => t.getAttribute("tabindex"))).toEqual(["0", "-1", "-1"]);
    fireEvent.keyDown(items[0] as HTMLElement, { key: "ArrowRight" });
    expect(onChange).toHaveBeenLastCalledWith("b");
    fireEvent.keyDown(items[0] as HTMLElement, { key: "ArrowLeft" });
    expect(onChange).toHaveBeenLastCalledWith("c");
    fireEvent.keyDown(items[0] as HTMLElement, { key: "End" });
    expect(onChange).toHaveBeenLastCalledWith("c");
    rerender(<Tabs tabs={tabs} active="c" onChange={onChange}><p>conteúdo</p></Tabs>);
    fireEvent.keyDown(within(screen.getByRole("tablist")).getAllByRole("tab")[2] as HTMLElement, { key: "Home" });
    expect(onChange).toHaveBeenLastCalledWith("a");
  });

  it("sem violações do axe (ligação aba-painel, nomes)", async () => {
    const { container } = render(<Tabs tabs={tabs} active="b" onChange={() => undefined}><p>conteúdo</p></Tabs>);
    const result = await axe.run(container, { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } });
    expect(result.violations.map((v) => v.id)).toEqual([]);
  });
});
