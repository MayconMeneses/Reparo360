import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import axe from "axe-core";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../App";
import { AuthProvider } from "../auth";
import { ForgotPasswordPage, ResetPasswordPage } from "./PasswordPages";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

const json = (status: number, body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
const noContent = () => Promise.resolve(new Response(null, { status: 204 }));
const audit = async (container: HTMLElement) =>
  (await axe.run(container, { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } })).violations.map((v) => v.id);
const TOKEN = "T".repeat(43);

describe("esqueci minha senha", () => {
  it("mostra sempre a mesma mensagem, sem dizer se a conta existe, e não tem violações", async () => {
    const calls: Array<[string, RequestInit]> = [];
    vi.stubGlobal("fetch", (url: string, init: RequestInit) => { calls.push([url, init]); return json(202, { accepted: true }); });
    const { getByLabelText, getByRole, findByRole, container } = render(<ForgotPasswordPage />);
    expect(await audit(container)).toEqual([]);
    fireEvent.change(getByLabelText("E-mail da conta"), { target: { value: "alguem@teste.invalid" } });
    fireEvent.click(getByRole("button", { name: "Enviar link" }));
    const status = await findByRole("status");
    expect(status.textContent).toContain("Se existir uma conta com esse e-mail");
    expect(calls[0]?.[0]).toBe("/api/v1/auth/password-reset/request");
    expect(JSON.parse(String(calls[0]?.[1].body))).toEqual({ email: "alguem@teste.invalid" });
    expect(calls[0]?.[1].credentials).toBe("omit");
  });

  it("falha de conexão aparece como erro", async () => {
    vi.stubGlobal("fetch", () => Promise.reject(new Error("rede")));
    const { getByLabelText, getByRole, findByRole } = render(<ForgotPasswordPage />);
    fireEvent.change(getByLabelText("E-mail da conta"), { target: { value: "alguem@teste.invalid" } });
    fireEvent.click(getByRole("button", { name: "Enviar link" }));
    expect((await findByRole("alert")).textContent).toContain("Não foi possível conectar");
  });
});

describe("definir nova senha pelo link", () => {
  it("lê o token do fragmento, tira o token do endereço na hora e manda no corpo (sem cookie)", async () => {
    window.history.replaceState(null, "", `/redefinir-senha#t=${TOKEN}`);
    const calls: Array<[string, RequestInit]> = [];
    vi.stubGlobal("fetch", (url: string, init: RequestInit) => { calls.push([url, init]); return noContent(); });
    const { getByLabelText, getByRole, findByText, container } = render(<ResetPasswordPage />);
    await waitFor(() => expect(window.location.hash).toBe(""));
    expect(window.location.href).not.toContain(TOKEN);
    expect(await audit(container)).toEqual([]);
    expect((getByRole("button", { name: "Salvar nova senha" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(getByLabelText("Nova senha"), { target: { value: "senha-nova-bem-longa-1" } });
    fireEvent.change(getByLabelText("Repita a nova senha"), { target: { value: "senha-nova-bem-longa-1" } });
    fireEvent.click(getByRole("button", { name: "Salvar nova senha" }));
    await findByText("Senha definida");
    expect(calls[0]?.[0]).toBe("/api/v1/auth/password-reset/confirm");
    expect(calls[0]?.[0]).not.toContain(TOKEN);
    expect(JSON.parse(String(calls[0]?.[1].body))).toEqual({ token: TOKEN, newPassword: "senha-nova-bem-longa-1" });
    expect(calls[0]?.[1].credentials).toBe("omit");
  });

  it("confirmação diferente não é enviada; erro do servidor aparece sem revelar nada", async () => {
    window.history.replaceState(null, "", `/redefinir-senha#t=${TOKEN}`);
    let sent = 0;
    vi.stubGlobal("fetch", () => { sent += 1; return json(400, { error: { code: "LINK_DE_SENHA_INVALIDO", message: "Link inválido, vencido ou já usado. Peça um novo." } }); });
    const { getByLabelText, getByRole, findByRole } = render(<ResetPasswordPage />);
    fireEvent.change(getByLabelText("Nova senha"), { target: { value: "senha-nova-bem-longa-1" } });
    fireEvent.change(getByLabelText("Repita a nova senha"), { target: { value: "outra-senha-bem-longa-2" } });
    fireEvent.click(getByRole("button", { name: "Salvar nova senha" }));
    expect((await findByRole("alert")).textContent).toContain("não confere");
    expect(sent).toBe(0);
    fireEvent.change(getByLabelText("Repita a nova senha"), { target: { value: "senha-nova-bem-longa-1" } });
    fireEvent.click(getByRole("button", { name: "Salvar nova senha" }));
    await waitFor(() => expect(sent).toBe(1));
    expect((await findByRole("alert")).textContent).toContain("Link inválido, vencido ou já usado");
  });

  it("endereço sem o código mostra 'Link incompleto' e não oferece formulário", async () => {
    window.history.replaceState(null, "", "/redefinir-senha");
    vi.stubGlobal("fetch", () => noContent());
    const { findByText, queryByLabelText } = render(<ResetPasswordPage />);
    await findByText("Link incompleto");
    expect(queryByLabelText("Nova senha")).toBeNull();
  });
});

describe("link na tela de entrada", () => {
  const mountLogin = (passwordReset: boolean) => {
    vi.stubGlobal("fetch", (url: string) => {
      if (url.endsWith("/auth/options")) return json(200, { passwordReset });
      return json(401, { error: { code: "NAO_AUTENTICADO", message: "x" } });
    });
    return render(<MemoryRouter><AuthProvider><App /></AuthProvider></MemoryRouter>);
  };

  it("aparece só quando o servidor tem o envio de e-mail ligado", async () => {
    const on = mountLogin(true);
    await waitFor(() => expect(on.getByRole("link", { name: "Esqueci minha senha" })).toBeTruthy());
    cleanup();
    const off = mountLogin(false);
    await off.findByLabelText("E-mail");
    await new Promise((r) => setTimeout(r, 50));
    expect(off.queryByRole("link", { name: "Esqueci minha senha" })).toBeNull();
  });
});
