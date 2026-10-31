import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import axe from "axe-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MasterApp } from "./MasterApp";
import { setMasterCsrf } from "./masterApi";

afterEach(() => {
  cleanup();
  setMasterCsrf(null);
  vi.unstubAllGlobals();
});

const json = (status: number, body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
const audit = async (container: HTMLElement) =>
  (await axe.run(container, { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } })).violations.map((v) => v.id);

const tenants = [
  { id: "11111111-1111-4111-8111-111111111111", name: "Modelo Celulares", tradeName: null, status: "ativa", createdAt: "2026-10-01T12:00:00Z", activeMembers: 3, workOrders: 12 },
  { id: "22222222-2222-4222-8222-222222222222", name: "Outra Assistência", tradeName: null, status: "suspensa", createdAt: "2026-10-02T12:00:00Z", activeMembers: 1, workOrders: 0 },
];

function stubServer(calls: Array<[string, RequestInit]>, signedIn: boolean) {
  vi.stubGlobal("fetch", (url: string, init: RequestInit = {}) => {
    calls.push([url, init]);
    if (url.endsWith("/master/me")) return signedIn ? json(200, { admin: { name: "Operador", email: "o@p.invalid" }, csrfToken: "csrf-1" }) : json(401, { error: { code: "NAO_AUTENTICADO", message: "x" } });
    if (url.endsWith("/auth/login")) return json(200, { challenge: "c".repeat(43), expiresInSeconds: 300 });
    if (url.endsWith("/auth/mfa")) { signedIn = true; return json(200, { csrfToken: "csrf-1" }); }
    if (url.endsWith("/master/tenants")) return json(200, { tenants });
    return Promise.resolve(new Response(null, { status: 204 }));
  });
}

describe("Master: entrada em duas etapas e painel", () => {
  it("sem sessão mostra só a senha; depois da senha pede o código; só então abre o painel", async () => {
    const calls: Array<[string, RequestInit]> = [];
    stubServer(calls, false);
    const { findByLabelText, findByRole, getByLabelText, getByRole, findByText, container } = render(<MasterApp />);
    fireEvent.change(await findByLabelText("E-mail"), { target: { value: "o@p.invalid" } });
    fireEvent.change(getByLabelText("Senha"), { target: { value: "senha-sintetica-123" } });
    expect(await audit(container)).toEqual([]);
    fireEvent.click(getByRole("button", { name: "Continuar" }));

    const code = await findByLabelText("Código");
    expect(calls.some(([url]) => url.endsWith("/master/tenants"))).toBe(false);
    fireEvent.change(code, { target: { value: "12ab34cd56" } });
    expect((code as HTMLInputElement).value).toBe("123456");
    fireEvent.click(await findByRole("button", { name: "Entrar" }));

    await findByText("Empresas cadastradas (somente situação e contagens)");
    expect(await audit(container)).toEqual([]);
    const mfa = calls.find(([url]) => url.endsWith("/auth/mfa"));
    expect(JSON.parse(String(mfa?.[1].body))).toEqual({ challenge: "c".repeat(43), code: "123456" });
    for (const [, init] of calls) expect(init.credentials).toBe("same-origin");
  });

  it("senha não fica guardada no navegador e erro de código volta para a senha", async () => {
    vi.stubGlobal("fetch", (url: string) => {
      if (url.endsWith("/master/me")) return json(401, { error: { code: "NAO_AUTENTICADO", message: "x" } });
      if (url.endsWith("/auth/login")) return json(200, { challenge: "c".repeat(43), expiresInSeconds: 300 });
      return json(401, { error: { code: "CODIGO_MFA_INVALIDO", message: "Código inválido ou expirado. Entre novamente." } });
    });
    const { findByLabelText, getByLabelText, getByRole, findByRole } = render(<MasterApp />);
    fireEvent.change(await findByLabelText("E-mail"), { target: { value: "o@p.invalid" } });
    fireEvent.change(getByLabelText("Senha"), { target: { value: "senha-sintetica-123" } });
    fireEvent.click(getByRole("button", { name: "Continuar" }));
    fireEvent.change(await findByLabelText("Código"), { target: { value: "000000" } });
    fireEvent.click(await findByRole("button", { name: "Entrar" }));
    expect((await findByRole("alert")).textContent).toContain("Código inválido");
    expect((getByLabelText("Senha") as HTMLInputElement).value).toBe("");
    expect(window.localStorage.length + window.sessionStorage.length).toBe(0);
  });

  it("suspender pede motivo e código novo; manda reautenticação e depois a mudança, com o token CSRF", async () => {
    const calls: Array<[string, RequestInit]> = [];
    stubServer(calls, true);
    const { findByRole, getByLabelText, getByRole, findByText } = render(<MasterApp />);
    fireEvent.click(await findByRole("button", { name: "Suspender Modelo Celulares" }));
    const confirm = getByRole("button", { name: "Confirmar" }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.change(getByLabelText(/Motivo/), { target: { value: "Pedido formal do dono" } });
    fireEvent.change(getByLabelText(/Código novo/), { target: { value: "654321" } });
    fireEvent.click(confirm);
    await findByText(/situação alterada para Suspensa/);

    const reauth = calls.find(([url]) => url.endsWith("/auth/reauth"));
    const status = calls.find(([url]) => url.endsWith("/status"));
    expect(JSON.parse(String(reauth?.[1].body))).toEqual({ code: "654321" });
    expect(status?.[0]).toContain("/tenants/11111111-1111-4111-8111-111111111111/status");
    expect(JSON.parse(String(status?.[1].body))).toEqual({ status: "suspensa", reason: "Pedido formal do dono" });
    expect(JSON.stringify(status?.[1].headers)).toContain("csrf-1");
    await waitFor(() => expect(calls.indexOf(reauth!)).toBeLessThan(calls.indexOf(status!)));
  });

  it("empresa suspensa oferece Reativar e não mostra dados de cliente em lugar nenhum", async () => {
    stubServer([], true);
    const { findByRole, container } = render(<MasterApp />);
    await findByRole("button", { name: "Reativar Outra Assistência" });
    expect(container.textContent).not.toMatch(/telefone|e-mail do cliente|CPF/i);
  });
});
