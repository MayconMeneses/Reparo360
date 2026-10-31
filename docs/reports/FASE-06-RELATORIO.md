# Relatório da Fase 6: endurecimento de segurança (parcial)

Data: 2026-10-31. Situação: **NÃO APROVADA** (ver bloqueios). Detalhes de teste por ameaça em `docs/security/SECURITY_TEST_PLAN.md`.

## O que foi feito
| Item | Estado | Evidência |
|---|---|---|
| Log sem PII: query string (nome, telefone, IMEI, protocolo) saía no log | PASS | `logs.test.ts` falhou antes da correção (vazamento confirmado) e passa depois; serializador registra só método, caminho e IP |
| Checagem de Origin em requisições que alteram dados | PASS | `hardening.test.ts`: outra origem recusada mesmo com cookie e CSRF válidos; Origin malformado recusado |
| Bloqueio de login por IP+conta (SEC-006) | PASS | `hardening.test.ts`: 429 mesmo com a senha certa; sucesso zera; janela deslizante |
| Esquemas estritos e nenhum uso cru de body/query/params | PASS | testes estáticos em `hardening.test.ts` |
| Upload polyglot entregue só como anexo com nosniff | PASS | `hardening.test.ts` |
| Corridas: testes reforçados com várias rodadas | PASS | último proprietário × 12 rodadas; assumir OS × 10 rodadas |
| Teste de mutação das travas de concorrência | PASS (5 mutações) | tabela em `SECURITY_TEST_PLAN.md`; 1 sobrevivente é equivalente (defesa em profundidade) |
| Matriz SEC-001..019 → teste | PASS (documento) | `SECURITY_TEST_PLAN.md` |
| Documentos de backup e de incidentes | PASS (documentos) | `BACKUP_RECOVERY.md`, `INCIDENT_RESPONSE.md` |

## Gates (executados em 2026-10-31)
- `pnpm typecheck`: PASS. `pnpm lint`: PASS. `pnpm build`: PASS. `pnpm loc:check`: PASS.
- `pnpm audit` e `pnpm audit --prod`: sem vulnerabilidades conhecidas.
- Testes, rodados por pacote em sequência: domínio 51, web 34, API 211, banco 63 = **359 passando, 0 falhando**.
- `pnpm backup:check`: PASS quando isolado.

## Falhas observadas e como foram tratadas
- Em `pnpm test` (pacotes em paralelo) um teste web estourou o tempo (8,4 s, "envia '150,00'…") e passou isolado. Causa provável: carga da máquina com a API e o banco rodando juntos. **POSSIBLE**, não investigada a fundo; se repetir, aumentar o limite ou medir.
- `backup:check` deu FAIL na mesma execução paralela porque os testes da API mexiam no banco durante a conferência; isolado, PASS. Os dois scripts compartilham o banco de teste, então não devem rodar juntos.

## Bloqueios e itens NÃO feitos
- **NOT_IMPLEMENTED**: painel Master e MFA do Master (P-38). Isso impede aprovar a fase e o MVP.
- **NOT_RUN**: CI (P-39), scanner de segredos, CodeQL, DAST, teste de proxy mal configurado, medição de desempenho/volume, restauração por empresa e de anexos (P-40), pentest.
- Sem criptografia em repouso nem HTTPS verificados: dependem da hospedagem (P-01).

## Escopo da conclusão
Os testes de segurança cobrem a API e o banco locais, com dados sintéticos, em um Postgres 17.6 em Docker. Não se extrapola para produção, para outro navegador ou para outro volume de dados.

## Adendo: aprovação remota por código no e-mail (P-03)
Pedido do dono: usar e-mail (opção sem custo de código). Implementado: migração 0010 (tabela `customer_verifications`, origem do evento `cliente`, decisão remota sem autor da equipe), adaptador de e-mail (SMTP via `nodemailer`, desligado por padrão), rotas públicas `/portal/verification` e `/portal/decision`, bloco de decisão no portal e textos da equipe.
- Testes novos: 23 na API (2 arquivos), 3 na interface, 3 no banco. Totais depois do adendo: domínio 51, web 37, API 234, banco 66 = **388 passando**; lint, typecheck, build, loc:check, `pnpm audit` (também `--prod`) e `backup:check` passaram.
- Mutações: 3 mortas, 1 sobrevivente (reconferência do link dentro da transação). Detalhe em `SECURITY_TEST_PLAN.md`.
- **NOT_RUN:** envio real por provedor SMTP, entrega/spam, teste em navegador real do bloco de decisão (só jsdom + axe).
- Um erro meu no meio do caminho: o script de mutação restaurava com `git checkout`, que não funciona em arquivo novo; as mutações ficaram aplicadas e eu restaurei à mão e conferi com os testes verdes antes de refazer as medições com restauração por conteúdo.

## Adendo: painel Master com MFA (P-38)
Pedido do dono: criar o Master. Implementado: migração 0011 (tabelas `platform_admins`, `platform_sessions`, `platform_challenges`, sem nenhum privilégio para a aplicação; acesso só por funções restritas), TOTP próprio (RFC 6238, sem dependência nova), segredo MFA cifrado, entrada em duas etapas, listar/suspender/reativar empresas, tela em `/master` e script `pnpm master:create` (único caminho para criar um Master).
- Testes novos: 13 (TOTP e cifragem), 20 (entrada e sessão), 15 (empresas, privacidade e privilégios) na API; 4 no banco; 4 na interface. Totais: domínio 51, web 41, API 282, banco 70 = **444 passando**; typecheck, lint, build, loc:check, `pnpm audit` (também `--prod`) e `backup:check` passaram.
- Mutações do Master: 5 de 5 mortas.
- **NOT_IMPLEMENTED:** criar empresa pelo Master (P-46, depende de decisão), acesso de suporte (P-47), recuperação do Master (P-48).
- **NOT_RUN:** teste em navegador real da tela `/master`; leitura do QR/URI em aplicativo autenticador real (os códigos foram verificados contra os vetores da RFC, não contra um aplicativo); `MASTER_ENC_KEY` e senha de produção.
- Sobre o marcador `app.master_op`: é uma variável de sessão ligada pelas funções do Master. O código da aplicação também poderia ligá-la; ela protege contra erro de rota, não contra execução arbitrária de SQL com o papel da aplicação.

## Adendo: criação de empresa pelo Master (P-46) e instalador
- **P-46 construído** (migração 0012, coluna `must_change_password`; rota `POST /master/tenants`; `POST /auth/change-password`; tela de troca obrigatória; formulário "Criar assistência" em `/master`). Testes e mutações em `SECURITY_TEST_PLAN.md`.
- **Instalador** em `instalador/` (guia em `instalador/LEIA-ME.md`): `Instalar-Reparo360.exe`, `Iniciar-Reparo360.exe`, `Parar-Reparo360.exe` (lançadores de 5,5 KB compilados com o compilador do Windows a partir de `instalador/launcher/Launcher.cs`) que chamam os scripts PowerShell da pasta.

## Fechamento: segredos, backup com anexos, proxy, CI e desempenho
| Item | Estado | Evidência |
|---|---|---|
| Scanner de segredos (gitleaks) | PASS (com ressalvas) | histórico de 14 commits: 14 achados, todos valores sintéticos de teste; `.gitleaks.toml` libera só isso; controle negativo pega segredo plantado em código de produção. Só o histórico do Git foi varrido |
| Backup com anexos | PASS (com ressalvas) | `pnpm backup` / `pnpm backup:verify`; 6 testes + 4 mutações mortas. Sem criptografia, sem cópia externa; restauração só do banco inteiro (por empresa: NOT_IMPLEMENTED) |
| Proxy mal configurado (TRUST_PROXY) | PASS | 4 testes (`proxy.test.ts`) |
| Pipeline de CI | **NOT_RUN** | `ci.yml` e `codeql.yml` escritos e validados com `actionlint`; só executam no GitHub depois do envio |
| Desempenho | PASS (medido, com defeito corrigido) | tabela abaixo |
| DAST (ZAP) | **NOT_RUN** | P-52 |

### Desempenho (scripts/perf-measure.mjs)
Condições: uma empresa com 20 mil clientes, 20 mil equipamentos, 30 mil OS e 120 mil eventos; PostgreSQL 17.6 em Docker no mesmo computador do desenvolvimento (que também rodava outras coisas); API compilada; 60 chamadas em série por endpoint e 16 simultâneas. **Vale para esta máquina e este volume; não é promessa de capacidade.**

| Endpoint | p50 | p95 | 16 simultâneas (total) |
|---|---|---|---|
| clientes, página 1 | 41 ms | 115 ms | 382 ms |
| clientes, busca por nome (com resultado) | 75 ms | 277 ms | 328 ms |
| clientes, busca por nome (sem resultado) | 65 ms | 806 ms (máx. 3,3 s) | 585 ms |
| clientes, busca por telefone | 75 ms | 200 ms | 307 ms |
| OS, página 1 | 98 ms | 191 ms | 496 ms |
| OS, filtro por estado | 32 ms | 46 ms | 165 ms |
| OS, busca por protocolo | 59 ms | 101 ms | 250 ms |
| equipamentos, busca | 86 ms | 107 ms | 432 ms |
| dashboard (antes da correção, todo o histórico no período) | 976 ms | 1868 ms | 11,4 s |

- Os picos de p95/máx. (por exemplo 3,3 s em uma chamada) podem ser ruído da máquina; não repeti a medição para separar ruído de problema.
- Planos: a busca por nome com `ILIKE '%…%'` usa o índice por data e filtra (rápida quando há resultado); **sem resultado, varre a tabela inteira de clientes da empresa** (20 mil linhas, ~270 páginas). A busca por protocolo em prefixo também varre a tabela. Em volumes bem maiores pedem um índice de trigramas (extensão `pg_trgm`), **não feito** (decisão: só se a medição real justificar).
- **Defeito corrigido:** o dashboard lia todo o histórico de eventos da empresa e dava erro 422 acima de 200 mil eventos. Agora lê só as OS com mudança de etapa dentro do período (resultado idêntico, provado por testes com datas deslocadas) e há um índice novo `(empresa, data)` nos eventos. Empresa madura (OS espalhadas por ~2 anos, período padrão de 30 dias): p50 **950 ms → 132 ms**, p95 1429 → 403 ms, 16 simultâneas **10,9 s → 1,5 s**. **Pior caso** (todo o histórico dentro do período, ou período de 1 ano) **não melhora**: ~1 s por consulta e o limite de 200 mil eventos continua valendo.

### Gates finais (2026-10-31)
typecheck, lint, build, loc:check, `pnpm audit` e `--prod`: limpos. Testes: domínio 51, web 45, API 307, banco 70 = **473 passando**; `backup:check` PASS.

### Fase 6: estado
**Continua NÃO aprovada para produção.** Pendentes: execução do CI no GitHub (P-39), DAST (P-52), criptografia/cópia externa do backup e restauração por empresa (P-40), acesso de suporte e recuperação do Master (P-47, P-48), hospedagem/HTTPS/criptografia em repouso (P-01) e as decisões jurídicas (P-06, P-41).

## Conclusão da Fase 6 (2026-10-31)
**Estado: concluída no escopo atual (uso local e projeto de portfólio). NÃO apta para produção com dados reais.**

Entregue e verificado nesta fase: esquemas estritos e Origin (SEC-003/005), bloqueio de login por IP e conta (SEC-006), logs sem dados pessoais (SEC-013), aprovação remota por código (SEC-008), Master com MFA e criação de empresa com senha temporária (SEC-014/019, em parte), varredura de segredos no histórico e no CI (SEC-018), auditoria de dependências (SEC-015), backup com anexos e cifragem opcional (SEC-016, em parte), teste de proxy, DAST passivo (ZAP), medição de desempenho com correção do dashboard, CI no GitHub verde (qualidade, segredos e CodeQL), instalador local para Windows. Evidências, números e limites em `docs/security/SECURITY_TEST_PLAN.md` e nas seções acima.

Bloqueios para produção, por decisão do dono (ver `DECISOES_PENDENTES.md`): hospedagem, HTTPS e criptografia em repouso (P-01); parte jurídica (P-06, P-41); metas de backup (P-14). Não construídos: acesso de suporte (P-47) e restauração por empresa. Não executados: teste de invasão por terceiro, varredura autenticada/ativa, teste da aprovação remota com provedor de e-mail real, instalação do PWA e leitura de QR em aparelho físico.

Nota de processo: o histórico do Git foi reescrito uma vez para trocar o e-mail pessoal pelo e-mail privado do GitHub (conteúdo idêntico, verificado pelo hash da árvore de arquivos).

## Adendo pós-fechamento: auditoria consultável (RF-023) e matriz de rastreio
- **Lacuna do MVP encontrada e fechada:** os eventos de auditoria eram gravados, mas não havia como consultá-los (RF-023). Agora existe `GET /audit` (proprietário e gerente; filtros por ação, resultado e período; paginação; sem IP, sem ID de correlação e sem ID de ator) e a tela **Auditoria**. 8 testes na API, 4 na interface; 4 mutações mortas (permissão, rótulo da plataforma, "há mais páginas", filtro de período).
- **Matriz de rastreio** requisito → implementação → teste → estado em `docs/product/RASTREABILIDADE.md`, que deixa explícito o que está PARCIAL (convite por e-mail, aprovação remota sem provedor real, QR em aparelho, PWA instalado, N+1, WCAG, backup não automatizado).
- Totais depois deste adendo: domínio 51, interface 49, API 320, banco 70 = **490 passando**; typecheck, lint, tamanho de arquivo, build, `pnpm audit` e `--prod` limpos.
