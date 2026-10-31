import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import axe from "axe-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PortalPage } from "./PortalPage";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.location.hash = "";
});

const TOKEN = "C".repeat(43);
const json = (status: number, body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));

const view = (extra: object = {}) => ({
  protocol: "2026-000001", state: { code: "AGUARDANDO_APROVACAO", label: "Aguardando a decisão sobre o orçamento" },
  device: { category: "celular", brand: "Samsung", model: "Galaxy A54" }, assistance: { name: "Modelo Celulares", phone: "8533334444" },
  timeline: [{ label: "Equipamento recebido", at: "2026-10-30T12:00:00Z" }],
  quote: { number: 1, state: "enviado", subtotalCents: 24180, discountCents: 0, totalCents: 24180, validUntil: "2026-11-06T12:00:00Z", paymentTerms: "À vista", estimatedDays: 3, items: [{ kind: "peca", description: "Bateria", quantity: 1, unitPriceCents: 15000 }] },
  decisionMessage: "Para aprovar ou recusar, peça o código que enviaremos ao seu e-mail cadastrado.", readyForPickup: false,
  canDecide: true, emailHint: "m***@teste.invalid", ...extra,
});

describe("portal: aprovação à distância por código", () => {
  it("sem canDecide, não mostra o bloco de decisão", async () => {
    vi.stubGlobal("fetch", () => json(200, view({ canDecide: false, emailHint: undefined })));
    window.location.hash = `#t=${TOKEN}`;
    const { findByText, queryByText } = render(<PortalPage />);
    await findByText("Acompanhe seu atendimento");
    expect(queryByText("Aprovar ou recusar o orçamento")).toBeNull();
  });

  it("pede o código, envia a decisão com o código no corpo e o token só em cabeçalho, sem cookie", async () => {
    const calls: Array<[string, RequestInit]> = [];
    let viewCalls = 0;
    vi.stubGlobal("fetch", (url: string, init: RequestInit) => {
      calls.push([url, init]);
      if (url.endsWith("/portal/order")) return json(200, viewCalls++ === 0 ? view() : view({ canDecide: false, state: { code: "EM_REPARO", label: "Em reparo" } }));
      if (url.endsWith("/portal/verification")) return json(202, { sent: true, emailHint: "m***@teste.invalid", expiresInMinutes: 10 });
      return json(200, { decision: "aprovado", state: "EM_REPARO" });
    });
    window.location.hash = `#t=${TOKEN}`;
    const { findByRole, findByLabelText, getByRole, findByText, queryByText, container } = render(<PortalPage />);

    fireEvent.click(await findByRole("button", { name: "Enviar código por e-mail" }));
    const input = await findByLabelText(/Código recebido por e-mail/);
    expect((await axe.run(container, { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } })).violations).toEqual([]);

    expect((getByRole("button", { name: "Aprovar orçamento" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(input, { target: { value: "12ab34cd56" } });
    expect((input as HTMLInputElement).value).toBe("123456");
    fireEvent.click(getByRole("button", { name: "Aprovar orçamento" }));

    await waitFor(() => expect(queryByText("Aprovar ou recusar o orçamento")).toBeNull());
    await findByText("Em reparo");

    const decision = calls.find(([url]) => url.endsWith("/portal/decision"));
    expect(JSON.parse(String(decision?.[1].body))).toEqual({ decision: "aprovado", code: "123456" });
    for (const [url, init] of calls) {
      expect(url).not.toContain(TOKEN);
      expect(init.credentials).toBe("omit");
      expect(JSON.stringify(init.headers)).toContain(TOKEN);
    }
  });

  it("mostra a mensagem do servidor quando o código está errado e mantém o bloco aberto", async () => {
    vi.stubGlobal("fetch", (url: string) => {
      if (url.endsWith("/portal/order")) return json(200, view());
      if (url.endsWith("/portal/verification")) return json(202, { sent: true, expiresInMinutes: 10 });
      return json(422, { error: { code: "CODIGO_INVALIDO", message: "Código inválido ou expirado." } });
    });
    window.location.hash = `#t=${TOKEN}`;
    const { findByRole, findByLabelText, getByRole } = render(<PortalPage />);
    fireEvent.click(await findByRole("button", { name: "Enviar código por e-mail" }));
    fireEvent.change(await findByLabelText(/Código recebido por e-mail/), { target: { value: "000000" } });
    fireEvent.click(getByRole("button", { name: "Recusar orçamento" }));
    expect((await findByRole("alert")).textContent).toContain("Código inválido ou expirado.");
    expect(getByRole("button", { name: "Aprovar orçamento" })).toBeTruthy();
  });
});
