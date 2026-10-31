# Matriz de rastreio: requisito → implementação → teste → evidência

Estado em 2026-10-31. Cada linha aponta onde o requisito está implementado e qual teste o exercita. Os caminhos de teste são relativos a `apps/api/tests` (API), `apps/web/src` (interface) e `packages/*/tests` ou `packages/domain/src` (banco e domínio). Estados: **PASS** (teste automatizado executado e passando), **PARCIAL** (parte coberta; o limite está dito), **NOT_RUN** (existe, mas não foi verificado do jeito que o requisito pede), **NOT_IMPLEMENTED**.
Os números e o resultado de execução estão em `docs/reports/FASE-06-RELATORIO.md`; o CI do GitHub roda tudo a cada envio. "PASS" significa que os testes listados passam, não que o requisito não tenha defeitos.

## Requisitos funcionais

| ID | Implementação | Testes | Estado | Limite |
|---|---|---|---|---|
| RF-001 Cadastro com proprietário | `modules/identity` (`provisionTenant`), `modules/master` (criar assistência) | `auth.test.ts`, `master-create.test.ts` | PASS | O cadastro público vem desligado; o caminho normal é o Master |
| RF-002 Login, sessão opaca, logout | `modules/identity`, `session-guard.ts` | `auth.test.ts`, `isolation.test.ts` (reautenticação), `hardening.test.ts` | PASS | |
| RF-003 Gerir equipe | `modules/team` | `isolation.test.ts`, `web: pages/team.test.tsx` | PARCIAL | "Convidar" é senha inicial entregue em pessoa; convite por e-mail (P-18) não foi feito |
| RF-004 Clientes, busca e duplicidade | `modules/customers` | `customers-devices.test.ts` | PASS | |
| RF-005 Equipamentos do cliente | `modules/devices` | `customers-devices.test.ts` | PASS | |
| RF-006 Recebimento (defeito, estado, acessórios, checklist, fotos) | `modules/work-orders`, `modules/attachments` | `work-orders.test.ts`, `attachments.test.ts`, `packages/database/tests/integrity.test.ts` | PASS | A senha do aparelho nunca é guardada (só a marca "informada") |
| RF-007 OS com protocolo único | `work-orders.service.ts` (`nextProtocol`) | `work-orders.test.ts` (10 simultâneas, ano de São Paulo, idempotência) | PASS | |
| RF-008 Atribuir técnico | `work-orders.service.ts`, `workflow.service.ts` | `work-orders.test.ts`, `workflow.test.ts` (inclui corrida × 10 rodadas) | PASS | |
| RF-009 Estados só por transições válidas | `packages/domain/src/state-machine.ts`, `work-orders/transitions.ts` | `workflow.test.ts`, `domain: state-machine.test.ts` | PASS | |
| RF-010 Diagnóstico | `modules/diagnostics` | `quotes-drafts.test.ts`, `packages/database/tests/quotes.test.ts` | PASS | |
| RF-011 Orçamento versionado, total no servidor | `modules/quotes`, `packages/domain/src/quote.ts` | `quotes-drafts.test.ts`, `quotes.test.ts` (banco), `domain: quote.test.ts` | PASS | |
| RF-012 Enviar e decidir vinculado à versão | `quotes.workflow.ts` | `quotes-decision.test.ts` | PASS | |
| RF-013 Aprovação remota verificada | `modules/portal/portal-decision.ts`, `mail/mailer.ts` | `portal-remote.test.ts`, `portal-remote-abuse.test.ts`, `web: pages/portal-decision.test.tsx` | PARCIAL | Testada com coletor de e-mail em memória; **nenhum envio por provedor real foi testado** |
| RF-014 Aprovação presencial registrada | `quotes.workflow.ts` (`decideQuote`) | `quotes-decision.test.ts` | PASS | |
| RF-015 Reparo registrado | `modules/bench` | `bench.test.ts` | PASS | Controle de estoque não existe (peças são texto) |
| RF-016 Checklist de testes finais | `modules/bench`, `packages/domain/src/testing.ts` | `bench.test.ts`, `domain: testing.test.ts` | PASS | |
| RF-017 Liberar retirada e entrega | `modules/bench`, `modules/delivery` | `delivery.test.ts`, `bench.test.ts`, `lifecycle.test.ts` | PASS | |
| RF-018 PDFs | `modules/documents` | `documents.test.ts`, `documents-forms.test.ts`, `units.test.ts` | PASS | Não são documentos fiscais (dito no próprio PDF) |
| RF-019 Portal com linha do tempo | `modules/portal` | `portal.test.ts`, `web: a11y.test.tsx` | PASS | Lista branca de campos e eventos |
| RF-020 QR da etiqueta sem dados pessoais | `web: components/Qr.tsx`, `pages/LabelPage.tsx` | só `web: format.test.ts` indireto | PARCIAL | A página da etiqueta não tem teste próprio; **leitura do QR em aparelho físico: NOT_RUN**; o QR leva a um endereço interno que exige login (P-37) |
| RF-021 Dashboard operacional | `modules/dashboard` | `dashboard.test.ts`, `dashboard-window.test.ts` | PASS | Tempo por etapa mede ~1 s no pior caso (todo o histórico no período) |
| RF-022 Painel Master | `modules/master`, `web: master/*` | `master.test.ts`, `master-tenants.test.ts`, `master-create.test.ts`, `master-units.test.ts`, `packages/database/tests/master.test.ts`, `web: master/master.test.tsx` | PASS | "Métricas técnicas" = situação, membros ativos e quantidade de ordens; sem acesso de suporte a dados (P-47 não construído) |
| RF-023 Auditoria consultável | `modules/audit`, `web: pages/AuditPage.tsx` | `audit.test.ts`, `web: pages/audit.test.tsx` | PASS | Só proprietário e gerente; não mostra IP nem identificadores internos |

## Requisitos não funcionais

| ID | Implementação / verificação | Testes ou comando | Estado | Limite |
|---|---|---|---|---|
| RNF-001 Monólito modular TypeScript | `apps/api`, `apps/web`, `packages/domain`, `packages/database` | `pnpm typecheck` | PASS | |
| RNF-002 Paginação; sem N+1 | `limit`/`offset` em todas as listagens | `customers-devices.test.ts`, `work-orders.test.ts`, `audit.test.ts`; medição `scripts/perf-measure.mjs` | PARCIAL | Paginação testada; **N+1 não foi caçado com ferramenta**, só medido o tempo dos principais endpoints |
| RNF-003 WCAG 2.2 AA | tokens com contraste calculado, alvos de 44 px, rótulos | `web: a11y.test.tsx` (axe, regras estruturais), `styles/contrast.test.ts` | PARCIAL | Sem auditoria manual, sem leitor de tela, sem Lighthouse; contraste real renderizado não verificado |
| RNF-004 Mobile-first (portal e PWA) | CSS responsivo, manifesto e service worker | verificação por script em 375 px | PARCIAL | **Instalação do PWA em aparelho real: NOT_RUN** |
| RNF-005 Logs com correlação, sem dados pessoais | serializador de requisição em `app.ts` | `logs.test.ts`, `hardening.test.ts`, `portal.test.ts` | PASS | |
| RNF-006 Backup de banco e arquivos, restauração testada | `scripts/backup.mjs`, `scripts/restore-verify.mjs`, `scripts/backup-restore-check.mjs` | `backup.test.ts`, `backup-encrypted.test.ts`, `pnpm backup:check` | PARCIAL | **Não é automatizado** (sem agendamento), sem cópia externa; restauração só do banco inteiro |
| RNF-007 Coesão e tamanho de arquivo | `scripts/check-file-size.mjs` | `pnpm loc:check` (limite de 300 linhas, 0 sem justificativa) | PASS | O limite mede tamanho, não coesão; revisão de coesão é humana |

## Segurança (SEC-001 a SEC-019)

A matriz própria, com os testes e as mutações, está em `docs/security/SECURITY_TEST_PLAN.md`.

## Lacunas conhecidas deste rastreio
- O rastreio cobre os requisitos do PRD (RF-001 a RF-023 e RNF-001 a RNF-007). Os 30 critérios de aceite da especificação mestra não estão neste repositório e, portanto, não foram cruzados aqui.
- Não houve teste de ponta a ponta em navegador real (Playwright ou equivalente) nem teste de carga.
