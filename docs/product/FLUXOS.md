# Fluxos e máquina de estados da OS

## Estados

`RECEBIDA`, `EM_DIAGNOSTICO`, `AGUARDANDO_APROVACAO`, `AGUARDANDO_PECA`, `EM_REPARO`, `EM_TESTE`, `PRONTA_RETIRADA`, `PRONTA_RETIRADA_SEM_REPARO`, `ENTREGUE`, `ENCERRADA`, `CANCELADA`.

Terminais: `ENCERRADA`, `CANCELADA`. `ENTREGUE` só avança para `ENCERRADA`.

Papéis: P = proprietário, G = gerente, A = atendente, T = técnico (T atribuído à OS), S = sistema (job). P e G têm tudo que A e T têm, exceto onde indicado.

## Matriz de transições

| # | De | Ação | Para | Papéis | Condições | Evento | Reversível |
|---|---|---|---|---|---|---|---|
| 1 | RECEBIDA | iniciar_diagnostico | EM_DIAGNOSTICO | T, G, P | técnico atribuído | `diagnostico_iniciado` | não |
| 2 | RECEBIDA | cancelar | CANCELADA | G, P | motivo | `os_cancelada` | não |
| 3 | EM_DIAGNOSTICO | enviar_orcamento | AGUARDANDO_APROVACAO | A, G, P | diagnóstico válido (RN-020) e orçamento `enviado` | `orcamento_enviado` | via 9 |
| 4 | EM_DIAGNOSTICO | liberar_sem_reparo | PRONTA_RETIRADA_SEM_REPARO | T, G, P | diagnóstico inconclusivo ou reparo impossível; motivo | `liberada_sem_reparo` | via 19 |
| 5 | EM_DIAGNOSTICO | cancelar | CANCELADA | G, P | motivo | `os_cancelada` | não |
| 6 | AGUARDANDO_APROVACAO | aprovar_orcamento | EM_REPARO | S (decisão), A/G/P (presencial) | decisão `aprovado` na versão vigente; sem peça pendente | `orcamento_aprovado` | não |
| 7 | AGUARDANDO_APROVACAO | aprovar_orcamento | AGUARDANDO_PECA | idem 6 | decisão `aprovado`; peça indisponível informada | `orcamento_aprovado`, `aguardando_peca` | não |
| 8 | AGUARDANDO_APROVACAO | recusar / expirar | PRONTA_RETIRADA_SEM_REPARO | S, A, G, P | decisão `recusado` ou orçamento `expirado` | `orcamento_recusado` ou `orcamento_expirado` | via 19 |
| 9 | AGUARDANDO_APROVACAO | revisar_orcamento | EM_DIAGNOSTICO | A, T, G, P | cria nova versão; anterior vira `substituido` | `orcamento_revisado` | — |
| 10 | AGUARDANDO_PECA | peca_disponivel | EM_REPARO | T, G, P | — | `peca_recebida` | não |
| 11 | AGUARDANDO_PECA | liberar_sem_reparo / cancelar | PRONTA_RETIRADA_SEM_REPARO / CANCELADA | G, P | motivo | `liberada_sem_reparo` / `os_cancelada` | não |
| 12 | EM_REPARO | iniciar_testes | EM_TESTE | T, G, P | ao menos 1 tarefa de reparo registrada | `testes_iniciados` | via 14 |
| 13 | EM_REPARO | novo_defeito | EM_DIAGNOSTICO | T, G, P | descrição do novo defeito; novo orçamento será necessário | `novo_defeito_identificado` | — |
| 14 | EM_TESTE | reprovar_testes | EM_REPARO | T, G, P | ao menos 1 item reprovado; motivo | `testes_reprovados` | — |
| 15 | EM_TESTE | aprovar_testes | PRONTA_RETIRADA | T, G, P | RN-052 | `testes_aprovados`, `liberada_retirada` | via 18 |
| 16 | PRONTA_RETIRADA | entregar | ENTREGUE | A, G, P | registro de entrega completo (RN-051) | `entregue` | não |
| 17 | PRONTA_RETIRADA_SEM_REPARO | entregar | ENTREGUE | A, G, P | idem | `entregue` | não |
| 18 | PRONTA_RETIRADA | reabrir_bancada | EM_REPARO | G, P | motivo | `reaberta_bancada` | — |
| 19 | PRONTA_RETIRADA_SEM_REPARO | reabrir_diagnostico | EM_DIAGNOSTICO | G, P | motivo (cliente mudou de ideia, orçamento revisado) | `reaberta_diagnostico` | — |
| 20 | ENTREGUE | encerrar | ENCERRADA | G, P | — | `os_encerrada` | não |

Qualquer par (estado, ação) fora da tabela retorna `422 TRANSICAO_INVALIDA` sem alterar nada.

## Erros esperados
`TRANSICAO_INVALIDA` (422), `PERMISSAO_NEGADA` (403), `CONFLITO_DE_VERSAO` (409), `PRECONDICAO_NAO_ATENDIDA` (422, com código da condição), `OS_NAO_ENCONTRADA` (404, também para OS de outro tenant).

## Fluxos alternativos cobertos
- Orçamento recusado → 8. Expirado → 8 (job).
- Cliente sem resposta → orçamento expira → 8.
- Peça indisponível → 7/10/11.
- Diagnóstico inconclusivo / reparo impossível → 4.
- Novo defeito durante reparo → 13, novo orçamento, nova aprovação.
- Teste reprovado → 14.
- Cancelamento autorizado → 2, 5, 11 (G/P, motivo).
- Retorno ou reclamação posterior → nova OS com `os_origem_id` (RN-007).

## Fluxo principal de recebimento (passos)

1. Atendente busca/cria cliente (alerta de duplicidade, sem fusão automática).
2. Busca/cria equipamento do cliente.
3. Preenche inspeção: defeito relatado, estado físico, acessórios, checklist, fotos.
4. Servidor cria OS (`RECEBIDA`) + inspeção + evento na mesma transação e emite protocolo.
5. Gera comprovante de recebimento (PDF) e etiqueta com QR de identificação (sem dados pessoais).

## QR
- **Etiqueta física:** codifica identificador opaco da OS para a equipe autenticada. Escaneado fora do sistema ou sem login, não revela nada.
- **Link do consumidor:** URL com token individual, enviado ao consumidor por canal definido; exige verificação antes de decisões.
