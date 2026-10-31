import { expect, test } from "@playwright/test";
import { createTenant, outbox, resetAll } from "./support.js";

// Recuperação de senha de ponta a ponta: pedir o link, receber o "e-mail" (lido do arquivo do servidor de teste),
// abrir o link, definir a senha nova e entrar. O link também não pode ser usado de novo.
test.describe("recuperação de senha", () => {
  let account: Awaited<ReturnType<typeof createTenant>>;

  test.beforeAll(async () => {
    await resetAll();
    account = await createTenant("senha");
  });

  async function waitForLink(email: string, countBefore: number): Promise<string> {
    for (let i = 0; i < 60; i++) {
      const mails = outbox().filter((m) => m.to === email);
      if (mails.length > countBefore) {
        const link = /(https?:\/\/\S+\/redefinir-senha#t=[A-Za-z0-9_-]+)/.exec(mails.at(-1)!.text)?.[1];
        if (link) return link;
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error("o e-mail com o link não chegou");
  }

  test("esqueci a senha → link do e-mail → senha nova → entrar; o link não vale duas vezes", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "Esqueci minha senha" }).click();
    await expect(page.getByRole("heading", { name: "Esqueci minha senha" })).toBeVisible();

    // Conta que não existe e conta que existe recebem a MESMA mensagem
    await page.getByLabel("E-mail da conta").fill("ninguem@teste.invalid");
    await page.getByRole("button", { name: "Enviar link" }).click();
    const messageForMissing = await page.getByRole("status").innerText();
    await page.goto("/esqueci-senha");
    await page.getByLabel("E-mail da conta").fill(account.email);
    await page.getByRole("button", { name: "Enviar link" }).click();
    await expect(page.getByRole("status")).toHaveText(messageForMissing);

    const link = await waitForLink(account.email, 0);
    expect(link.startsWith("http://localhost:3995/redefinir-senha#t=")).toBe(true);
    expect(outbox().some((m) => m.to === "ninguem@teste.invalid")).toBe(false);

    await page.goto(link);
    await expect(page.getByRole("heading", { name: "Definir nova senha" })).toBeVisible();
    // O código sai do endereço na hora (não fica no histórico)
    await expect.poll(() => page.evaluate(() => window.location.hash)).toBe("");
    await page.getByLabel("Nova senha", { exact: true }).fill("senha-recuperada-e2e-1");
    await page.getByLabel("Repita a nova senha").fill("senha-recuperada-e2e-1");
    await page.getByRole("button", { name: "Salvar nova senha" }).click();
    await expect(page.getByRole("heading", { name: "Senha definida" })).toBeVisible();

    // A senha antiga não entra mais; a nova entra
    await page.getByRole("link", { name: "Ir para a entrada" }).click();
    await page.getByLabel("E-mail", { exact: true }).fill(account.email);
    await page.getByLabel("Senha", { exact: true }).fill(account.password);
    await page.getByRole("button", { name: "Entrar" }).click();
    await expect(page.getByRole("alert")).toContainText("incorretos");
    await page.getByLabel("Senha", { exact: true }).fill("senha-recuperada-e2e-1");
    await page.getByRole("button", { name: "Entrar" }).click();
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();

    // O mesmo link, usado de novo, é recusado
    await page.goto(link);
    await page.getByLabel("Nova senha", { exact: true }).fill("outra-senha-qualquer-2222");
    await page.getByLabel("Repita a nova senha").fill("outra-senha-qualquer-2222");
    await page.getByRole("button", { name: "Salvar nova senha" }).click();
    await expect(page.getByRole("alert")).toContainText("Link inválido, vencido ou já usado");
  });
});
