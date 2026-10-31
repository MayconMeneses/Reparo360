import { expect, test } from "@playwright/test";
import { createTenant, resetAll } from "./support.js";

// Fluxo do dia a dia de uma assistência, feito no navegador de verdade: entrar, cadastrar cliente e equipamento,
// abrir uma ordem de serviço e vê-la na lista; depois a auditoria mostra o que aconteceu.
test.describe("assistência: entrada e primeira ordem de serviço", () => {
  let account: Awaited<ReturnType<typeof createTenant>>;

  test.beforeAll(async () => {
    await resetAll();
    account = await createTenant("fluxo");
  });

  test("entra, cadastra cliente e equipamento, abre a OS e confere na lista e na auditoria", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Entrar no Reparo360" })).toBeVisible();

    // Senha errada: mensagem de erro, sem entrar.
    await page.getByLabel("E-mail", { exact: true }).fill(account.email);
    await page.getByLabel("Senha", { exact: true }).fill("senha-errada-123456");
    await page.getByRole("button", { name: "Entrar" }).click();
    await expect(page.getByRole("alert")).toContainText("incorretos");

    await page.getByLabel("Senha", { exact: true }).fill(account.password);
    await page.getByRole("button", { name: "Entrar" }).click();
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Principal" })).toBeVisible();

    // Cliente
    await page.getByRole("link", { name: "Clientes" }).click();
    await page.getByRole("link", { name: "Novo cliente" }).click();
    await page.getByLabel("Nome", { exact: true }).fill("Maria da Silva");
    await page.getByLabel("Telefone com DDD").fill("(85) 99999-1234");
    await page.getByRole("button", { name: "Salvar cliente" }).click();
    await expect(page.getByRole("heading", { name: "Maria da Silva" })).toBeVisible();

    // Equipamento
    await page.getByLabel("Marca").fill("Samsung");
    await page.getByLabel("Modelo").fill("Galaxy A54");
    await page.getByRole("button", { name: "Cadastrar equipamento" }).click();
    await expect(page.getByText("Equipamento cadastrado.")).toBeVisible();

    // Ordem de serviço
    await page.getByRole("link", { name: "Abrir ordem de serviço" }).click();
    await expect(page.getByRole("heading", { name: "Nova ordem de serviço" })).toBeVisible();
    await page.getByRole("radio", { name: /Samsung Galaxy A54/ }).check();
    await page.getByLabel("Defeito relatado pelo cliente").fill("Não liga depois de molhar");
    await page.getByLabel("Estado físico do aparelho").fill("Riscos na tampa traseira");
    await page.getByRole("button", { name: "Abrir ordem de serviço" }).click();
    await expect(page.getByRole("heading", { name: /^Ordem 2026-\d{6}$|^Ordem \d{4}-\d{6}$/ })).toBeVisible();

    // Aparece na lista de ordens
    await page.getByRole("link", { name: "Ordens", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Ordens de serviço" })).toBeVisible();
    await expect(page.getByRole("table")).toContainText("Maria da Silva");

    // Auditoria mostra o que aconteceu, com o nome de quem fez
    await page.getByRole("link", { name: "Auditoria" }).click();
    await expect(page.getByRole("heading", { name: "Auditoria" })).toBeVisible();
    await expect(page.getByRole("table")).toContainText("Ordem de serviço aberta");
    await expect(page.getByRole("table")).toContainText("Entrada no sistema");
    await expect(page.getByRole("table")).toContainText("Dono fluxo");

    // Sair encerra a sessão: o cookie deixa de valer
    await page.getByRole("button", { name: "Sair" }).click();
    await expect(page.getByRole("heading", { name: "Entrar no Reparo360" })).toBeVisible();
    await page.goto("/ordens");
    await expect(page.getByRole("heading", { name: "Entrar no Reparo360" })).toBeVisible();
  });

  test("endereço que não existe mostra a página 404 com caminho de volta", async ({ page }) => {
    const response = await page.goto("/nao-existe-mesmo");
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: "Página não encontrada" })).toBeVisible();
    await page.getByRole("link", { name: "Voltar ao início" }).click();
    await expect(page.getByRole("heading", { name: "Entrar no Reparo360" })).toBeVisible();
  });
});
