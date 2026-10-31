import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setCsrfToken } from "../api";
import { AuthProvider } from "../auth";
import { TeamPage } from "./TeamPage";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); setCsrfToken(null); });

const json = (status: number, body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
const meOf = (role: string) => ({ user: { id: "me", name: "Eu", email: "eu@t.invalid" }, tenant: { id: "t", name: "Loja" }, role, csrfToken: "csrf" });
const members = [
  { userId: "me", name: "Eu", email: "eu@t.invalid", role: "gerente", status: "ativo" },
  { userId: "dono", name: "Dono", email: "dono@t.invalid", role: "proprietario", status: "ativo" },
  { userId: "ana", name: "Ana", email: "ana@t.invalid", role: "atendente", status: "ativo" },
];

function mock(role: string, team: () => Promise<Response>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  vi.stubGlobal("fetch", (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    if (url === "/api/v1/me") return json(200, meOf(role));
    if (url === "/api/v1/team" && (init.method ?? "GET") === "GET") return team();
    if (url === "/api/v1/auth/reauth") return Promise.resolve(new Response(null, { status: 204 }));
    return json(201, { userId: "novo" });
  });
  return calls;
}

const renderPage = () => render(<MemoryRouter><AuthProvider><TeamPage /></AuthProvider></MemoryRouter>);

describe("tela de equipe", () => {
  it("gerente não vê ações sobre proprietário nem sobre si mesmo, e não pode criar gerente ou proprietário", async () => {
    mock("gerente", () => json(200, { members }));
    renderPage();
    await screen.findByText("Ana");
    const rows = screen.getAllByRole("row");
    const rowOf = (name: string) => rows.find((r) => within(r).queryByText(name)) as HTMLElement;
    expect(within(rowOf("Dono")).queryByRole("button")).toBeNull();
    expect(within(rowOf("Eu")).getByText("Você")).toBeTruthy();
    expect(within(rowOf("Ana")).getByRole("button", { name: "Desativar" })).toBeTruthy();
    const options = within(screen.getByLabelText("Função")).getAllByRole("option").map((o) => o.textContent);
    expect(options).toEqual(["Atendente", "Técnico"]);
  });

  it("proprietário pode cadastrar qualquer função", async () => {
    mock("proprietario", () => json(200, { members: [{ ...members[1], userId: "me" }, members[2]] }));
    renderPage();
    await screen.findByText("Ana");
    const options = within(screen.getByLabelText("Função")).getAllByRole("option").map((o) => o.textContent);
    expect(options).toEqual(["Proprietário", "Gerente", "Atendente", "Técnico"]);
  });

  it("senha antiga: pede a senha, confirma e então carrega a lista", async () => {
    let allowed = false;
    const calls = mock("proprietario", () => (allowed
      ? json(200, { members })
      : json(403, { error: { code: "REAUTENTICACAO_NECESSARIA", message: "Confirme sua senha para continuar." } })));
    renderPage();
    const field = await screen.findByLabelText("Sua senha");
    expect(screen.queryByText("Ana")).toBeNull();
    allowed = true;
    fireEvent.change(field, { target: { value: "senha-sintetica-123" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    await screen.findByText("Ana");
    const reauth = calls.find((c) => c.url === "/api/v1/auth/reauth");
    expect(JSON.parse(String(reauth?.init.body))).toEqual({ password: "senha-sintetica-123" });
    expect((reauth?.init.headers as Record<string, string>)["x-csrf-token"]).toBe("csrf");
  });

  it("atendente e técnico não têm acesso à tela", async () => {
    for (const role of ["atendente", "tecnico"]) {
      const calls = mock(role, () => json(200, { members }));
      renderPage();
      expect(await screen.findByText("Você não tem permissão para gerir a equipe.")).toBeTruthy();
      await waitFor(() => expect(calls.some((c) => c.url === "/api/v1/team")).toBe(false));
      cleanup();
    }
  });

  it("cadastrar envia os dados e a senha só no corpo (nunca na URL)", async () => {
    const calls = mock("proprietario", () => json(200, { members }));
    renderPage();
    await screen.findByText("Ana");
    fireEvent.change(screen.getByLabelText("Nome"), { target: { value: "Bia" } });
    fireEvent.change(screen.getByLabelText("E-mail"), { target: { value: "bia@t.invalid" } });
    fireEvent.change(screen.getByLabelText("Senha inicial"), { target: { value: "senha-inicial-123" } });
    fireEvent.click(screen.getByRole("button", { name: "Cadastrar membro" }));
    await waitFor(() => expect(calls.some((c) => c.url === "/api/v1/team/members")).toBe(true));
    const post = calls.find((c) => c.url === "/api/v1/team/members");
    expect(JSON.parse(String(post?.init.body))).toMatchObject({ name: "Bia", email: "bia@t.invalid", password: "senha-inicial-123", role: "proprietario" });
    expect(calls.map((c) => c.url).join(" ")).not.toContain("senha-inicial-123");
  });
});
