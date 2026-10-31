import { cleanup, render, waitFor } from "@testing-library/react";
import axe from "axe-core";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { AuthProvider } from "./auth";
import { PortalPage } from "./pages/PortalPage";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.location.hash = "";
});

// jsdom não calcula layout, então a regra de contraste de cor do axe fica desligada aqui; o contraste
// é verificado por cálculo nos tokens (styles/contrast.test.ts). As demais regras valem: rótulos, nomes,
// landmarks, hierarquia de títulos, tabelas, ARIA.
async function audit(container: HTMLElement) {
  const result = await axe.run(container, { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } });
  return result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`);
}

const json = (status: number, body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));

describe("acessibilidade (axe, regras estruturais)", () => {
  it("tela de login não tem violações e os campos têm rótulo", async () => {
    vi.stubGlobal("fetch", () => json(401, { error: { code: "NAO_AUTENTICADO", message: "x" } }));
    const { container, findByLabelText, findByRole } = render(
      <MemoryRouter><AuthProvider><App /></AuthProvider></MemoryRouter>,
    );
    await findByLabelText("E-mail");
    await findByLabelText("Senha");
    await findByRole("button", { name: "Entrar" });
    expect(await audit(container)).toEqual([]);
  });

  it("portal com link inválido avisa por role=alert e não tem violações", async () => {
    vi.stubGlobal("fetch", () => json(404, { error: { code: "LINK_INVALIDO", message: "Link inválido ou expirado." } }));
    window.location.hash = "#t=" + "A".repeat(43);
    const { container, findByRole } = render(<PortalPage />);
    expect((await findByRole("alert")).textContent).toContain("Link inválido ou expirado");
    expect(await audit(container)).toEqual([]);
  });

  it("portal com dados: tabela com legenda, listas e título; sem violações; envia o token em cabeçalho", async () => {
    const fetchMock = vi.fn(() => json(200, {
      protocol: "2026-000001", state: { code: "AGUARDANDO_APROVACAO", label: "Aguardando a decisão sobre o orçamento" },
      device: { category: "celular", brand: "Samsung", model: "Galaxy A54" }, assistance: { name: "Modelo Celulares", phone: "8533334444" },
      timeline: [{ label: "Equipamento recebido", at: "2026-10-30T12:00:00Z" }],
      quote: { number: 1, state: "enviado", subtotalCents: 24180, discountCents: 0, totalCents: 24180, validUntil: "2026-11-06T12:00:00Z", paymentTerms: "À vista", estimatedDays: 3, items: [{ kind: "peca", description: "Bateria", quantity: 1, unitPriceCents: 15000 }] },
      decisionMessage: "Para aprovar ou recusar o orçamento, fale com a assistência.", readyForPickup: false,
    }));
    vi.stubGlobal("fetch", fetchMock);
    const token = "B".repeat(43);
    window.location.hash = `#t=${token}`;
    const { container, findByText } = render(<PortalPage />);
    await findByText("Acompanhe seu atendimento");
    await waitFor(() => expect(container.querySelector("table caption")?.textContent).toBe("Itens do orçamento"));
    expect(await audit(container)).toEqual([]);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/v1/portal/order"); // o token NÃO está na URL
    expect(JSON.stringify(init.headers)).toContain(token);
    expect(init.credentials).toBe("omit"); // o portal nunca envia o cookie da equipe
  });
});
