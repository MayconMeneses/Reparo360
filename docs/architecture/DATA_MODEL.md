# Modelo conceitual de dados (MVP)

Conceitual, não é DDL. As migrações serão criadas por fase, somente para as entidades usadas no fluxo implementado. Revisão obrigatória antes da primeira migração (Fase 1).

## Convenções
- PK: UUID v7 (ou v4), gerado no servidor.
- Toda tabela operacional tem `tenant_id` e PK/UNIQUE compostas quando preciso (`(tenant_id, id)`), para que **FK composta** impeça vínculo entre tenants.
- RLS: `tenant_id = current_setting('app.tenant_id')::uuid`, definido com `SET LOCAL` por transação. Role da aplicação sem BYPASSRLS e sem ownership das tabelas.
- Dinheiro: `bigint` em centavos + `currency` fixo BRL no MVP.
- Datas: `timestamptz` UTC; `created_at`, `updated_at`; `version int` nas entidades concorrentes (OS, orçamento).
- Eventos e auditoria: append-only (sem UPDATE/DELETE para a role da aplicação).

## Entidades

**Identidade e tenancy** (sem RLS por tenant onde globais)
- `tenants` (id, nome, nome_comercial, status, criado_em)
- `tenant_settings` (tenant_id, contato, endereço opcional, logo opcional, config operacional)
- `users` (id, e-mail único, senha_hash Argon2id, mfa, status) — global
- `memberships` (tenant_id, user_id, papel, status)
- `sessions` (id hash, user_id, tenant_ativo_id, expira, revogada_em, ip/ua mínimos)

**Atendimento**
- `customers` (tenant_id, nome, telefone, e-mail?, observações)
- `devices` (tenant_id, customer_id, categoria, marca, modelo, cor?, serial?, imei?, observações)
- `work_orders` (tenant_id, protocolo único por tenant, customer_id, device_id, defeito_relatado, estado, prioridade, tecnico_id?, os_origem_id?, version, datas)
- `intake_inspections` (work_order_id, estado_físico, acessórios, checklist jsonb validado, recebido_por, recebido_em)
- `diagnostics` (work_order_id, natureza, sintomas, verificações, defeito, serviços_recomendados, autor, revisão)
- `repair_tasks` (work_order_id, procedimento, responsável, peças_descritivas, resultado, datas)
- `test_checks` (work_order_id, item, resultado, obrigatório, autor, data)
- `work_order_events` (work_order_id, tipo, de, para, ator, motivo?, payload mínimo, chave_idempotência) — append-only
- `deliveries` (work_order_id, entregue_por, retirado_por_nome, método_confirmação, itens_devolvidos, observação, data)

**Orçamentos**
- `quotes` (work_order_id, estado_comercial, versão_vigente_id)
- `quote_versions` (quote_id, número, total_centavos, desconto_centavos, validade, condições, previsão, enviada_em) — imutável após envio
- `quote_items` (quote_version_id, tipo peça|serviço, descrição, quantidade, preço_unitário_centavos)
- `quote_decisions` (quote_version_id, decisão, canal remoto|presencial, decidido_por, chave_idempotência, evidência mínima, data) — UNIQUE por versão

**Arquivos, documentos, acesso**
- `attachments` (tenant_id, work_order_id, chave_storage, tipo_verificado, tamanho, hash, enviado_por, excluído_em?)
- `generated_documents` (work_order_id, tipo, versão, chave_storage, gerado_por)
- `customer_access_grants` (work_order_id, token_hash, expira, revogado_em, tentativas)
- `verification_challenges` (grant_id, canal, código_hash, expira, tentativas, consumido_em)

**Segurança**
- `audit_events` (tenant_id?, ator, ação, alvo, resultado, correlação_id, data) — append-only

## Decisões de simplificação
- `tenant_settings` pode virar colunas de `tenants` se ficar com <8 campos (decidir na migração da Fase 1).
- `quotes` pode ser dispensada se `quote_versions` carregar estado e `work_order_id`; decidir na Fase 3 (afeta a regra de "um orçamento vigente por OS").
- `verification_challenges` só existe quando P-03 for decidido.

## Fora do MVP (não criar)
`branches`, `parts`, `stock_*`, `payments`, `expenses`, `warranty_claims`, `notification_deliveries`, `plans`, `subscriptions`, `integration_credentials`.

## Estado implementado (Fase 2)

Implementado: `customers`, `devices`, `work_orders`, `intake_inspections`, `work_order_events`, `attachments`, mais `protocol_counters` (não previsto no desenho inicial: contador por empresa e ano, sem lacunas em rollback).

Diferenças em relação ao desenho conceitual:
- `work_orders.idempotency_key` (UNIQUE por empresa) protege a abertura contra duplo clique.
- `attachments` usa exclusão lógica (`deleted_at`, `deleted_by`); só essas colunas podem ser atualizadas pela aplicação.
- `work_order_events` não tem chave de idempotência própria ainda (entra com a máquina de estados, Fase 3).
- `generated_documents` **não** foi criada: o comprovante é gerado sob demanda a partir dos dados da OS, sem versionamento persistido.
- Todas as FKs entre tabelas de empresa são compostas `(tenant_id, ...)`; a OS referencia `devices(tenant_id, customer_id, id)`, de modo que o equipamento precisa ser do cliente da OS.
- CHECK em estado, prioridade, categoria, tipo de anexo, IMEI e (retroativamente) papel e status das tabelas da Fase 1.

## Estado implementado (Fase 3)

Implementado: `diagnostics`, `quote_versions`, `quote_items`, `quote_decisions`.

Diferenças em relação ao desenho conceitual:
- A tabela `quotes` foi **dispensada** (previsto em "Decisões de simplificação"): `quote_versions` carrega o estado e o `work_order_id`. Um índice único parcial garante no máximo uma versão aberta (`rascunho` ou `enviado`) por OS.
- `quote_versions` tem `revision` (controle otimista do rascunho) e `based_on_diagnostic_id` / `suspicion_authorized_by` (P-09).
- **Imutabilidade no banco:** o gatilho `quote_versions_guard` congela itens, valores, prazos e condições depois do envio e só admite `rascunho→enviado` e `enviado→aprovado|recusado|expirado|substituido`. O gatilho `quote_items_guard` recusa qualquer mudança de item fora de rascunho (falha fechada sem contexto de empresa). Valem também para o papel migrador.
- `quote_decisions`: uma por versão (`UNIQUE`), append-only; `channel` aceita `presencial` e `remoto`, mas só `presencial` é gravado.
- `diagnostics`: append-only, uma linha por revisão.
- `work_order_events.actor_user_id` passou a aceitar nulo, **somente** para o evento do sistema `orcamento_expirado` (CHECK `events_actor_ck`).
- Valores monetários em `bigint` (centavos) com CHECK `total = subtotal - desconto` e `0 <= desconto <= subtotal`.

## Estado implementado (Fase 4)

Implementado: `repair_tasks`, `test_checks`, `deliveries` (todas append-only para a aplicação: `SELECT, INSERT`).

Diferenças em relação ao desenho conceitual:
- `repair_tasks` guarda o procedimento, peças em texto livre, desfecho (`concluido`, `parcial`, `sem_sucesso`) e o **ciclo de reparo**; evidências são os anexos da OS.
- `test_checks` guarda uma linha por item de cada rodada (`round`), presa ao **ciclo de testes**; a rodada efetiva é a de maior `round` no ciclo atual. Resultado: `aprovado`, `reprovado`, `nao_testado`, `nao_aplicavel`.
- `deliveries`: uma por OS (`UNIQUE`), sem número de documento do cliente; guarda quem retirou, o método de confirmação (P-28), os acessórios devolvidos e a observação.
- `work_orders` ganhou `repair_cycle` e `test_cycle` (contadores) e `origin_work_order_id` (retorno ou reclamação; FK composta para a própria tabela e CHECK de não apontar para si mesma).
- `generated_documents` segue **não criada** (P-30).
