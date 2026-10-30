# Regras de negócio — Reparo360

Regras propostas na Fase 0. Onde há dependência jurídica ou comercial, remete a `DECISOES_PENDENTES.md`.

## OS e protocolo
- **RN-001** Protocolo é único por tenant, gerado no servidor, formato legível (ex.: `2026-000123`); formato final em P-07. Nunca serve como credencial.
- **RN-002** Identificador interno da OS é UUID; protocolo e UUID nunca concedem acesso ao consumidor sozinhos.
- **RN-003** Estado da OS só muda por transição da máquina de estados (`FLUXOS.md`), validada no servidor, com evento gravado na mesma transação.
- **RN-004** Motivo é obrigatório em: cancelamento, retirada sem reparo, reprovação em teste, reversão de estado.
- **RN-005** Alteração concorrente usa controle otimista (`version`); conflito retorna 409, sem sobrescrever.
- **RN-006** Comando de transição é idempotente por chave de operação; duplo clique não gera dois eventos.
- **RN-007** OS encerrada é imutável. Retorno/reclamação cria nova OS com `os_origem_id`.

## Recebimento
- **RN-010** Item de checklist tem 4 valores: funcionando, com defeito, não testado, não aplicável. Valor padrão é "não testado".
- **RN-011** Senha de desbloqueio do aparelho não é armazenada em cadastro comum (ver P-08 para eventual campo temporário).
- **RN-012** Fotos de entrada são opcionais por tipo de serviço; mínimo configurável pela assistência (padrão: nenhum obrigatório).
- **RN-013** Recebimento registra quem recebeu, quando, acessórios e estado físico.

## Diagnóstico
- **RN-020** Diagnóstico tem natureza: `suspeita`, `confirmado` ou `inconclusivo`. Orçamento só pode ser enviado com diagnóstico `confirmado`, ou `suspeita` com marcação explícita de quem autorizou (P-09).
- **RN-021** Diagnóstico não é sobrescrito: nova revisão cria novo registro.

## Orçamento
- **RN-030** Valores em centavos inteiros (BRL). Nunca float.
- **RN-031** Total = soma(qtd × preço unitário) − desconto; calculado e validado no servidor. Total nunca vem do cliente.
- **RN-032** Desconto não pode exceder o subtotal; limite de desconto por papel é P-10.
- **RN-033** Orçamento enviado é imutável. Alteração cria nova versão; a anterior vira `substituido`.
- **RN-034** Decisão (aprovar/recusar) referencia `quote_version_id` exato. Decisão sobre versão substituída é rejeitada.
- **RN-035** Estados comerciais: rascunho, enviado, aprovado, recusado, expirado, substituido. Independentes do estado da OS.
- **RN-036** Validade é obrigatória; ao expirar, o job muda para `expirado` e registra evento. Prazo padrão: P-11.
- **RN-037** Decisão repetida com a mesma chave de idempotência devolve o resultado original; decisão conflitante é rejeitada.
- **RN-038** Orçamento deve conter os elementos exigidos pelo CDC. Lista confirmada por revisão jurídica antes do piloto (P-05).

## Aprovação
- **RN-040** Aprovação remota exige verificação do consumidor por canal definido em P-03. Sem provedor configurado, o sistema oferece só aprovação presencial; **não simula envio de código**.
- **RN-041** Aprovação presencial registra responsável da assistência, método e observação, e é rotulada `presencial`.
- **RN-042** Token do portal: aleatório de alta entropia, armazenado só como hash, com expiração, limite de tentativas e revogação.

## Entrega e encerramento
- **RN-050** Entrega só a partir de `PRONTA_RETIRADA` ou `PRONTA_RETIRADA_SEM_REPARO`.
- **RN-051** Entrega registra responsável, quem retirou, método de confirmação, itens devolvidos e observação. Não exige documento pessoal por padrão.
- **RN-052** `aprovar_testes` (→ `PRONTA_RETIRADA`) exige, na última rodada do ciclo de testes atual: ao menos um item `aprovado`, nenhum `reprovado` e nenhum `nao_testado` (o que não se aplica é marcado `nao_aplicavel`). Rodada vazia ou só de `nao_aplicavel` nunca aprova. Não existe item "opcional": quem registra não consegue dispensar um item não testado.
- **RN-053** `reprovar_testes` exige ao menos um item `reprovado` na última rodada do ciclo e motivo; a OS volta a `EM_REPARO` em um novo ciclo.
- **RN-054** A entrega grava o registro de entrega e move a OS para `ENTREGUE` na mesma transação. Se os acessórios devolvidos diferem dos recebidos, a observação é obrigatória. Não se coleta número de documento do cliente.
- **RN-055** Encerramento (`ENTREGUE` → `ENCERRADA`) é manual, por gerente ou proprietário (P-17).

## Multi-tenant e dados
- **RN-060** Toda linha operacional pertence a um tenant; relacionamentos entre tenants diferentes são impossíveis (FK composta com `tenant_id`).
- **RN-061** Tenant ativo vem da sessão no servidor, nunca de parâmetro livre.
- **RN-062** Suspensão de tenant preserva dados; não há exclusão automática por inadimplência.

## Indicadores do dashboard
Todo indicador declara fonte, período, fórmula, unidade, inclusão e exclusão.

| Indicador | Fórmula | Inclui | Exclui |
|---|---|---|---|
| OS abertas | contagem de OS com estado não terminal | RECEBIDA…PRONTA_RETIRADA* | ENTREGUE, ENCERRADA, CANCELADA |
| Recebidas no período | OS com `created_at` no período | todas | — |
| Por estado atual | contagem por estado | estados operacionais | terminais, salvo "Entregues" |
| Orçamentos aprovados/recusados | contagem de decisões únicas no período | última decisão por versão | versões substituídas |
| Tempo por etapa | mediana entre eventos de entrada e saída do estado | OS que concluíram a etapa | OS ainda na etapa |
| Serviços por categoria | contagem de OS por categoria do equipamento | todas no período | canceladas |

- **RN-070** Valor orçado nunca é apresentado como faturamento recebido (recebimento é V2).
- **RN-071** Cada OS conta uma vez por indicador, independentemente de eventos repetidos.
