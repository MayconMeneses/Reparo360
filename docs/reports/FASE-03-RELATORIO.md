# Relatório — Fase 3 (Diagnóstico, orçamento e aprovação)

1. **Fase:** 3
2. **Objetivo:** máquina de estados da OS, bancada (fila e assumir OS), diagnóstico, orçamento versionado com cálculo no servidor, decisão (aprovação/recusa) e expiração.
3. **Commit/branch:** nenhum commit da Fase 3 (aguardando autorização). Última referência: `ddb4df7` (Fase 2).
4. **Decisões aplicadas:** P-09, P-10 (com desvio), P-11, P-12, P-13. **P-03 segue aberto: a aprovação remota (RF-013) está BLOQUEADA.**

## Resultado dos gates

| Gate | Estado | Evidência (comando observado) |
|---|---|---|
| Typecheck | PASS | `pnpm typecheck`, saída 0 |
| Lint | PASS | `pnpm lint`, "No issues found" |
| Testes de domínio | PASS | 36/36 (máquina de estados, orçamento, permissões) |
| Testes de banco | PASS | 48/48 (inclui gatilhos, CHECKs, RLS, privilégios) |
| Testes de API | PASS | 126/126 em 10 arquivos |
| Build | PASS | `pnpm build` gera `apps/api/dist/server.js` |
| Smoke do bundle (ponta a ponta) | PASS | 14/14 passos contra `dist/server.js`: cadastro, técnico, OS, diagnóstico, rascunho, envio, edição recusada, aprovação presencial, repetição idempotente, decisão oposta recusada, histórico |
| Limite de linhas (RNF-007) | PASS | 88 arquivos, nenhum acima de 300 |
| Backup e restauração | PASS | 21 políticas e flags FORCE idênticas após restaurar (banco de teste) |
| Auditoria de dependências | PASS | `pnpm audit`: 0 |
| Aprovação remota (RF-013) | **BLOCKED** | depende de P-03 (canal de verificação) |
| Agendador de expiração automática | **NOT_RUN** | não existe; ver P-25 |
| Testes E2E de interface, performance, DAST/SAST | NOT_RUN | sem interface ainda; Fase 6 |

**Total: 210 testes, 210 passaram**, contra PostgreSQL 17 real, dados sintéticos.

## Funcionalidades entregues
- **Máquina de estados:** tabela completa de 19 regras no domínio (idêntica a `docs/product/FLUXOS.md`), com teste de que todo par (estado, ação) fora da tabela é recusado, todo estado é alcançável a partir de `RECEBIDA` e os terminais não têm saída. `POST /work-orders/:id/transitions` expõe só as ações diretas; as da Fase 4 e as do orçamento respondem `ACAO_INDISPONIVEL`.
- **Concorrência:** toda mudança de estado incrementa `version`; duplo clique recebe 409 e grava um único evento. Ordem de travas fixa (OS, depois orçamento).
- **Fila e assumir OS (P-12):** sem dados pessoais; dois técnicos disputando a mesma OS: exatamente um vence.
- **Diagnóstico:** append-only por revisão; só com a OS em diagnóstico; suspeita/confirmado exigem o defeito.
- **Orçamento versionado:** totais em centavos calculados no servidor (campos de total enviados pelo cliente são rejeitados); limite de desconto por papel conferido ao salvar e ao enviar; uma versão aberta por OS; revisão cria nova versão e marca a anterior como `substituido`.
- **Imutabilidade no banco:** depois do envio, itens, valores, prazo e condições não mudam nem para o papel migrador (gatilhos testados diretamente no banco).
- **Decisão presencial:** vinculada à versão exata, rotulada `presencial`, com o nome de quem decidiu e o funcionário que registrou; idempotente (mesma decisão = 200 sem repetir a transição; oposta = 409; aprovar e recusar ao mesmo tempo = uma só vale).
- **Expiração:** a tentativa de decidir um orçamento vencido grava a expiração e **depois** responde 422 (a expiração não é desfeita pelo erro); varredura por empresa via `POST /quotes/expire-due`; o evento do sistema fica sem autor.

## Defeitos encontrados e corrigidos
- Nenhum defeito de produto foi achado pelos testes desta fase.
- Falhas de **teste** corrigidas na causa: o teste de "falha fechada" esperava erro, mas a RLS filtra tudo e o `DELETE` apaga 0 linhas (comportamento seguro; o teste agora prova que nada mudou); um teste reutilizou uma OS que já tinha versão aberta.
- Lint e tamanho: variável sem uso em `updateDraft` e `quotes.test.ts` com 346 linhas (dividido por coesão em dois arquivos).
- Retrocorreção (item do advisor): `assignTechnician` agora recusa OS fechada para alterações (`OS_ENCERRADA`), com teste.

## Desvios e limitações (declarados)
- **RN-006 (idempotência por chave de operação):** nas transições a proteção é por **versão** (`expectedVersion`), não por chave. Nas decisões a idempotência é real (uma por versão). Documentado em `FLUXOS.md`.
- **P-10/P-11 não configuráveis por empresa:** limites de desconto e validade padrão são constantes no domínio. A recomendação era configurável.
- **Aprovação remota inexistente** (P-03): não há portal, token nem desafio de verificação. O esquema aceita `channel = 'remoto'`, mas nada o grava.
- **Expiração só sob demanda:** sem agendador, um orçamento vencido que ninguém toca continua `enviado` e a OS em `AGUARDANDO_APROVACAO`. A varredura engole falhas por item (conta em `failed`, sem log detalhado).
- **Rascunho preservado** ao cancelar/liberar sem reparo (decisão registrada em `FLUXOS.md`); não há descarte explícito de rascunho.
- Quantidade de item só inteira (P-26). Descrição de item é texto livre.
- **PDFs de orçamento e de registro de aprovação não foram feitos**; os elementos exigidos pelo CDC (P-05/P-27) não foram revisados juridicamente. Hoje o orçamento traz itens, preços, total, validade, condições de pagamento e previsão de execução.
- Edições de rascunho não geram evento no histórico (só criação, envio, revisão e decisão).
- Os testes de concorrência verificam o invariante, mas **não foi feito teste de mutação** (não confirmado que falham sem as travas).
- Desempenho não medido. Busca e listagens seguem sem índice trigram.

## Pendências herdadas (inalteradas)
S3/MinIO (P-02), backup de arquivos, EXIF/malware (P-23), órfãos (P-22), recuperação de senha (P-03/P-21), rate limit compartilhado (P-20), CI/CD, DAST/SAST, OpenAPI, projeto no OneDrive.

## Riscos residuais
Sem aprovação remota nem agendador, o ciclo do orçamento depende de operação manual no balcão. O consumidor ainda não tem acesso a nada (portal na Fase 5).

## Próximos passos
Fase 4: tarefas e registro de reparo, checklist de testes finais, retirada/entrega, documentos (orçamento, aprovação, entrega) e as transições da fase 4 (`iniciar_testes` a `encerrar`). Antes: P-17 (encerramento manual ou automático) e P-05 (revisão jurídica dos documentos).

**Status: PENDENTE** — nenhum gate reprovou e os 210 testes passam, mas RF-013 está BLOQUEADO (P-03), o agendador de expiração está NOT_RUN e há desvios declarados (RN-006, P-10/P-11). A fase aguarda sua revisão. Não é "APROVADA".
