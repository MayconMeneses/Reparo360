import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setCsrfToken } from "../api";
import { AuthProvider } from "../auth";
import { TeamPage } from "./TeamPage";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); setCsrfToken(null); });

const json = (status: number, body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
const me = { user: { id: "me", name: "Eu", email: "eu@t.invalid" }, tenant: { id: "t", name: "Loja" }, role: "proprietario", csrfToken: "csrf" };
const members = [{ userId: "me", name: "Eu", email: "eu@t.invalid", role: "proprietario", status: "ativo" }];

function mock(emailOn: boolean) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  vi.stubGlobal("fetch", (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    if (url === "/api/v1/me") return json(200, me);
    if (url === "/api/v1/auth/options") return json(200, { passwordReset: emailOn });
    if (url === "/api/v1/team" && (init.method ?? "GET") === "GET") return json(200, { members });
    if (url === "/api/v1/team/members") return json(202, { accepted: true });
    return json(404, {});
  });
  return calls;
}
const renderPage = () => render(<MemoryRouter><AuthProvider><TeamPage /></AuthProvider></MemoryRouter>);

describe("convite por e-mail na tela de equipe", () => {
  it("sem envio de e-mail ligado não oferece o convite e explica o que fazer", async () => {
    mock(false);
    renderPage();
    await screen.findByLabelText("Senha inicial");
    expect(screen.queryByLabelText(/Enviar convite por e-mail/)).toBeNull();
    expect(screen.getByText(/precisa do envio de e-mail configurado/)).toBeTruthy();
  });

  it("com e-mail ligado, marcar o convite esconde a senha e envia SEM senha, só com inviteByEmail", async () => {
    const calls = mock(true);
    renderPage();
    const box = await screen.findByLabelText(/Enviar convite por e-mail/);
    fireEvent.change(screen.getByLabelText("Nome"), { target: { value: "Bia Nova" } });
    fireEvent.change(screen.getByLabelText("E-mail"), { target: { value: "bia@t.invalid" } });
    fireEvent.click(box);
    expect(screen.queryByLabelText("Senha inicial")).toBeNull();
    expect(screen.getByText(/Você não vê nem escolhe a senha/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Enviar convite" }));
    await waitFor(() => expect(calls.some((c) => c.url === "/api/v1/team/members")).toBe(true));
    const post = calls.find((c) => c.url === "/api/v1/team/members")!;
    const body = JSON.parse(String(post.init.body));
    expect(body).toEqual({ name: "Bia Nova", email: "bia@t.invalid", role: "proprietario", inviteByEmail: true });
    expect(await screen.findByText("Convite enviado por e-mail.")).toBeTruthy();
  });
});
