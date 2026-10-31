import { expect, test, type Page } from "@playwright/test";
import { nextCode, resetAll, seedMaster, type SeededMaster } from "./support.js";

// A administração da plataforma no navegador: entrada em duas etapas, criar assistência (senha temporária),
// primeiro acesso do proprietário (troca obrigatória) e suspensão (derruba a sessão do proprietário).
test.describe("Master: criar assistência e suspender", () => {
  let master: SeededMaster;

  test.beforeAll(async () => {
    await resetAll();
    master = await seedMaster();
  });

  async function masterLogin(page: Page) {
    await page.goto("/master");
    await expect(page.getByRole("heading", { name: "Administração da plataforma" })).toBeVisible();
    await page.getByLabel("E-mail", { exact: true }).fill(master.email);
    await page.getByLabel("Senha", { exact: true }).fill(master.password);
    await page.getByRole("button", { name: "Continuar" }).click();
    await page.getByLabel("Código", { exact: true }).fill(await nextCode(master));
    await page.getByRole("button", { name: "Entrar" }).click();
    await expect(page.getByRole("heading", { name: "Assistências" })).toBeVisible();
  }

  test("entrada em duas etapas: senha errada e código errado não abrem nada", async ({ page }) => {
    await page.goto("/master");
    await page.getByLabel("E-mail", { exact: true }).fill(master.email);
    await page.getByLabel("Senha", { exact: true }).fill("senha-errada-123456");
    await page.getByRole("button", { name: "Continuar" }).click();
    await expect(page.getByRole("alert")).toContainText("incorretos");
    await expect(page.getByLabel("Código", { exact: true })).toHaveCount(0);

    await page.getByLabel("Senha", { exact: true }).fill(master.password);
    await page.getByRole("button", { name: "Continuar" }).click();
    await page.getByLabel("Código", { exact: true }).fill("000000");
    await page.getByRole("button", { name: "Entrar" }).click();
    await expect(page.getByRole("alert")).toContainText("Código inválido");
    await expect(page.getByRole("heading", { name: "Assistências" })).toHaveCount(0);
  });

  test("cria a assistência, o dono troca a senha temporária e a suspensão derruba o acesso dele", async ({ page, browser }) => {
    await masterLogin(page);

    await page.getByRole("button", { name: "Criar assistência" }).click();
    await page.getByLabel("Nome da assistência").fill("Assistência E2E Mestre");
    await page.getByLabel("Nome do proprietário").fill("Dona Mestre");
    const ownerEmail = `dona-${Date.now()}@teste.invalid`;
    await page.getByLabel("E-mail do proprietário").fill(ownerEmail);
    await page.getByLabel("Código novo do autenticador").fill(await nextCode(master));
    await page.getByRole("button", { name: "Criar", exact: true }).click();
    await expect(page.getByText("Assistência criada.")).toBeVisible();
    const temporary = (await page.locator("code").nth(1).innerText()).trim();
    expect(temporary.length).toBeGreaterThanOrEqual(16);
    await expect(page.getByRole("table")).toContainText("Assistência E2E Mestre");
    // A senha temporária não aparece na tabela
    await expect(page.getByRole("table")).not.toContainText(temporary);

    // Primeiro acesso do proprietário, em outro navegador (outra sessão)
    const ownerContext = await browser.newContext();
    const owner = await ownerContext.newPage();
    await owner.goto("/");
    await owner.getByLabel("E-mail", { exact: true }).fill(ownerEmail);
    await owner.getByLabel("Senha", { exact: true }).fill(temporary);
    await owner.getByRole("button", { name: "Entrar" }).click();
    await expect(owner.getByRole("heading", { name: "Defina sua senha" })).toBeVisible();
    await expect(owner.getByRole("navigation", { name: "Principal" })).toHaveCount(0); // nada do sistema abre
    await owner.getByLabel("Senha temporária", { exact: true }).fill(temporary);
    await owner.getByLabel("Nova senha", { exact: true }).fill("minha-senha-definitiva-e2e-1");
    await owner.getByLabel("Repita a nova senha").fill("minha-senha-definitiva-e2e-1");
    await owner.getByRole("button", { name: "Salvar nova senha" }).click();
    await expect(owner.getByRole("heading", { name: "Dashboard" })).toBeVisible();

    // O Master suspende; a sessão do dono cai na hora
    await page.getByRole("button", { name: "Suspender Assistência E2E Mestre" }).click();
    await page.getByLabel(/Motivo/).fill("Teste de suspensão no navegador");
    await page.getByLabel(/Código novo/).fill(await nextCode(master));
    await page.getByRole("button", { name: "Confirmar" }).click();
    await expect(page.getByText(/situação alterada para Suspensa/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Reativar Assistência E2E Mestre" })).toBeVisible();

    await owner.reload();
    await expect(owner.getByRole("heading", { name: "Entrar no Reparo360" })).toBeVisible();
    await ownerContext.close();

    // Reativar devolve o acesso
    await page.getByRole("button", { name: "Reativar Assistência E2E Mestre" }).click();
    await page.getByLabel(/Motivo/).fill("Reativação depois do teste");
    await page.getByLabel(/Código novo/).fill(await nextCode(master));
    await page.getByRole("button", { name: "Confirmar" }).click();
    await expect(page.getByText(/situação alterada para Ativa/)).toBeVisible();
  });
});
