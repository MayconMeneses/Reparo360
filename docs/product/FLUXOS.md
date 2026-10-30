# Fluxos e máquina de estados da OS

> A tabela abaixo é a mesma de `packages/domain/src/state-machine.ts`. Alterar uma exige alterar a outra no mesmo commit (há teste de consistência no domínio).

## Estados

`RECEBIDA`, `EM_DIAGNOSTICO`, `AGUARDANDO_APROVACAO`, `AGUARDANDO_PECA`, `EM_REPARO`, `EM_TESTE`, `PRONTA_RETIRADA`, `PRONTA_RETIRADA_SEM_REPARO`, `ENTREGUE`, `ENCERRADA`, `CANCELADA`.

Terminais: `ENCERRADA`, `CANCELADA`. `ENTREGUE` só avança para `ENCERRADA`.

Papéis: P = proprietário, G = gerente, A = atendente, T = técnico (T atribuído à OS), S = sistema (expiração). P e G têm o que A e T têm, exceto onde indicado.

Modo: **direto** = endpoint genérico `POST /work-orders/:id/transitions` (com pré-condições por ação); **orçamento** = efeito do ciclo do orçamento (endpoints de orçamento); **entrega** = só junto com o registro de entrega (`POST /work-orders/:id/delivery`).

## Matriz de transições

| # | Ação | De | Para | Papéis | Condições | Evento | Modo |
|---|---|---|---|---|---|---|---|
| 1 | `iniciar_diagnostico` | RECEBIDA | EM_DIAGNOSTICO | T, G, P | técnico atribuído | `diagnostico_iniciado` | direto |
| 2, 5, 11 | `cancelar` | RECEBIDA, EM_DIAGNOSTICO, AGUARDANDO_PECA | CANCELADA | G, P | motivo | `os_cancelada` | direto |
| 3 | `enviar_orcamento` | EM_DIAGNOSTICO | AGUARDANDO_APROVACAO | A, G, P | diagnóstico válido (RN-020), orçamento enviado | `orcamento_enviado` | orçamento |
| 4 | `liberar_sem_reparo` | EM_DIAGNOSTICO | PRONTA_RETIRADA_SEM_REPARO | T, G, P | motivo | `liberada_sem_reparo` | direto |
| 6 | `aprovar_orcamento` | AGUARDANDO_APROVACAO | EM_REPARO | A, G, P (S na aprovação remota, futura) | decisão `aprovado` na versão vigente | `orcamento_aprovado` | orçamento |
| 7 | `aprovar_orcamento_aguardando_peca` | AGUARDANDO_APROVACAO | AGUARDANDO_PECA | A, G, P | idem; peça indisponível informada | `orcamento_aprovado` | orçamento |
| 8a | `recusar_orcamento` | AGUARDANDO_APROVACAO | PRONTA_RETIRADA_SEM_REPARO | A, G, P | decisão `recusado` | `orcamento_recusado` | orçamento |
| 8b | `expirar_orcamento` | AGUARDANDO_APROVACAO | PRONTA_RETIRADA_SEM_REPARO | S | validade vencida | `orcamento_expirado` | orçamento |
| 9 | `revisar_orcamento` | AGUARDANDO_APROVACAO | EM_DIAGNOSTICO | A, G, P | cria nova versão; anterior vira `substituido` | `orcamento_revisado` | orçamento |
| 10 | `peca_disponivel` | AGUARDANDO_PECA | EM_REPARO | T, G, P | — | `peca_recebida` | direto |
| 11b | `liberar_sem_reparo_aguardando_peca` | AGUARDANDO_PECA | PRONTA_RETIRADA_SEM_REPARO | G, P | motivo | `liberada_sem_reparo` | direto |
| 12 | `iniciar_testes` | EM_REPARO | EM_TESTE | T, G, P | ao menos 1 tarefa de reparo | `testes_iniciados` | direto |
| 13 | `novo_defeito` | EM_REPARO | EM_DIAGNOSTICO | T, G, P | motivo; novo orçamento será necessário | `novo_defeito_identificado` | direto |
| 14 | `reprovar_testes` | EM_TESTE | EM_REPARO | T, G, P | ao menos 1 item reprovado; motivo | `testes_reprovados` | direto |
| 15 | `aprovar_testes` | EM_TESTE | PRONTA_RETIRADA | T, G, P | RN-052 | `testes_aprovados` | direto |
| 16, 17 | `entregar` | PRONTA_RETIRADA, PRONTA_RETIRADA_SEM_REPARO | ENTREGUE | A, G, P | registro de entrega completo (RN-051) | `entregue` | entrega |
| 18 | `reabrir_bancada` | PRONTA_RETIRADA | EM_REPARO | G, P | motivo | `reaberta_bancada` | direto |
| 19 | `reabrir_diagnostico` | PRONTA_RETIRADA_SEM_REPARO | EM_DIAGNOSTICO | G, P | motivo | `reaberta_diagnostico` | direto |
| 20 | `encerrar` | ENTREGUE | ENCERRADA | G, P | — | `os_encerrada` | direto |

Qualquer par (estado, ação) fora da tabela retorna `422 TRANSICAO_INVALIDA` sem alterar nada. Ação de modo orçamento ou entrega no endpoint genérico retorna `422 ACAO_INDISPONIVEL`. A conferência de estado e de papel vem **antes** das pré-condições de registros, para a mensagem nunca enganar.

Mudanças em relação à versão da Fase 0: ações de aprovação/recusa/expiração/liberação ganharam nomes distintos (uma ação por destino); o **técnico saiu da revisão de orçamento** (linha 9), pois a recomendação P-13 limita o técnico ao rascunho.

## Ciclos de reparo e de testes
Cada entrada em `EM_REPARO` abre um ciclo de reparo e cada entrada em `EM_TESTE` abre um ciclo de testes (contadores em `work_orders`). Tarefas de reparo e rodadas de testes ficam presas ao ciclo em que nasceram. Assim, `iniciar_testes` exige reparo registrado **neste** ciclo de bancada, e `aprovar_testes` exige uma rodada registrada **neste** ciclo de testes: nada de uma passagem anterior libera o equipamento. Não se comparam horários.

## Controle de concorrência
Toda mudança de estado incrementa `work_orders.version`. O endpoint direto exige `expectedVersion`; uma segunda chamada com a mesma versão (duplo clique) recebe `409 CONFLITO_DE_VERSAO`. **Desvio da RN-006**: a proteção é por versão, não por chave de idempotência da operação. Nas decisões de orçamento a idempotência é real (uma decisão por versão do orçamento).

Ordem de travas: sempre a linha da OS primeiro, depois a versão do orçamento.

## Erros esperados
`TRANSICAO_INVALIDA` (422), `ACAO_INDISPONIVEL` (422), `PERMISSAO_NEGADA` (403), `CONFLITO_DE_VERSAO` (409), `PRECONDICAO_NAO_ATENDIDA` (422, com código da condição), `OS_NAO_ENCONTRADA` (404, também para OS de outra empresa ou não atribuída ao técnico).

## Fluxos alternativos cobertos
- Orçamento recusado → 8a. Expirado → 8b. Cliente sem resposta → orçamento expira → 8b.
- Peça indisponível → 7, 10, 11b.
- Diagnóstico inconclusivo / reparo impossível → 4.
- Novo defeito durante o reparo → 13, novo orçamento, nova aprovação.
- Teste reprovado → 14.
- Cancelamento autorizado → 2/5/11 (G/P, motivo).
- Retorno ou reclamação posterior → nova OS com `origin_work_order_id` (RN-007): a origem precisa estar `ENTREGUE` ou `ENCERRADA`, ser da mesma empresa e do mesmo equipamento.
- Cliente muda de ideia após recusa → 19 (G/P, motivo) e novo orçamento.

## Rascunho de orçamento ao sair do diagnóstico
Cancelar ou liberar sem reparo **não apaga** o rascunho: ele fica preservado (e editável se a OS voltar a `EM_DIAGNOSTICO`). Só pode existir uma versão aberta (rascunho ou enviada) por OS.

## Fluxo principal de recebimento (passos)

1. Atendente busca/cria cliente (alerta de duplicidade, sem fusão automática).
2. Busca/cria equipamento do cliente.
3. Preenche inspeção: defeito relatado, estado físico, acessórios, checklist, marca "senha informada".
4. Servidor cria OS (`RECEBIDA`) + inspeção + evento na mesma transação e emite protocolo.
5. Gera comprovante de recebimento (PDF).

## Aprovação do orçamento
- **Presencial** (implementada): atendente/gerente/proprietário registra a decisão com o nome de quem decidiu e uma observação; fica rotulada `presencial`.
- **Remota** (RF-013): **bloqueada** até a decisão P-03 (canal de verificação do consumidor). Sem provedor de envio configurado, o sistema não simula códigos.

## QR
- **Etiqueta física:** codifica identificador opaco da OS para a equipe autenticada (Fase 5).
- **Link do consumidor:** URL com token individual; exige verificação antes de decisões (Fase 5, depende de P-03).
