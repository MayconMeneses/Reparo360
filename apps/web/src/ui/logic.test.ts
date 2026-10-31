import { describe, expect, it } from "vitest";
import { availableActions } from "../order/actions";
import { centsToInput, parseMoneyToCents } from "./money";

describe("parseMoneyToCents", () => {
  it("aceita formatos brasileiros e devolve centavos inteiros", () => {
    const cases: Array<[string, number]> = [["1.234,56", 123456], ["45,9", 4590], ["150", 15000], ["0,05", 5], ["R$ 10,00", 1000], [" 7 ", 700], ["1.000", 100000], ["0", 0]];
    for (const [input, cents] of cases) expect(parseMoneyToCents(input), input).toBe(cents);
  });

  it("recusa o que é ambíguo ou inválido (nunca adivinha)", () => {
    for (const bad of ["", "abc", "-5", "1,234", "12.5", "1.23", "1,2,3", "R$", "10,", ",50", "9999999999999999999"]) {
      expect(parseMoneyToCents(bad), bad).toBeNull();
    }
  });

  it("ida e volta sem perder centavo", () => {
    for (const cents of [0, 5, 99, 100, 23180, 123456789]) expect(parseMoneyToCents(centsToInput(cents)), String(cents)).toBe(cents);
    expect(centsToInput(23180)).toBe("231,80");
  });
});

describe("availableActions (só apresentação; o servidor valida)", () => {
  const names = (state: string, role: "proprietario" | "gerente" | "atendente" | "tecnico", hasTechnician = true) =>
    availableActions(state, role, { hasTechnician }).map((r) => r.action);

  it("iniciar diagnóstico só aparece com técnico atribuído", () => {
    expect(names("RECEBIDA", "gerente", true)).toContain("iniciar_diagnostico");
    expect(names("RECEBIDA", "gerente", false)).not.toContain("iniciar_diagnostico");
  });

  it("atendente não vê ações diretas; técnico não cancela", () => {
    expect(names("RECEBIDA", "atendente")).toEqual([]);
    expect(names("EM_DIAGNOSTICO", "tecnico")).not.toContain("cancelar");
    expect(names("EM_DIAGNOSTICO", "gerente")).toEqual(expect.arrayContaining(["cancelar", "liberar_sem_reparo"]));
  });

  it("em teste, o técnico aprova ou reprova; entregar e ações do orçamento nunca aparecem", () => {
    expect(names("EM_TESTE", "tecnico")).toEqual(["reprovar_testes", "aprovar_testes"]);
    for (const state of ["PRONTA_RETIRADA", "AGUARDANDO_APROVACAO"]) {
      for (const role of ["proprietario", "gerente", "atendente", "tecnico"] as const) {
        const list = names(state, role);
        for (const hidden of ["entregar", "aprovar_orcamento", "recusar_orcamento", "enviar_orcamento", "expirar_orcamento"]) expect(list, `${state}/${role}`).not.toContain(hidden);
      }
    }
  });

  it("encerrar só para gerente/proprietário e só entregue; terminais não têm ação", () => {
    expect(names("ENTREGUE", "gerente")).toEqual(["encerrar"]);
    expect(names("ENTREGUE", "atendente")).toEqual([]);
    expect(names("ENCERRADA", "proprietario")).toEqual([]);
    expect(names("CANCELADA", "proprietario")).toEqual([]);
  });
});

import { ApiError, errorMessage } from "../api";

describe("errorMessage", () => {
  it("acrescenta os motivos que o servidor enviou", () => {
    const error = new ApiError(422, "TESTES_NAO_APROVAVEIS", "Os testes finais não permitem liberar o equipamento.", { reasons: ["há item não testado", "nenhum item aprovado"] });
    expect(errorMessage(error)).toBe("Os testes finais não permitem liberar o equipamento. Motivo: há item não testado; nenhum item aprovado.");
  });
  it("sem motivos, usa só a mensagem; erro de rede tem texto próprio", () => {
    expect(errorMessage(new ApiError(404, "X", "Não encontrado."))).toBe("Não encontrado.");
    expect(errorMessage(new TypeError("fetch failed"))).toBe("Falha de conexão. Tente novamente.");
  });
});
