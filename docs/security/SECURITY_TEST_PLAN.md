# Plano de testes de segurança (Fase 6)

Mapeia cada ameaça de `THREAT_MODEL.md` ao teste que a exercita e ao estado real. Estados: PASS (teste executado e passando), PARCIAL (cobre parte), NOT_RUN (não executado), NOT_IMPLEMENTED (controle ainda não existe).
Os nomes abaixo são títulos de testes em `apps/api/tests` (API) e `packages/database/tests` (banco). Rodar: `pnpm test`.

| Ameaça | Teste (arquivo) | Estado | Observação |
|---|---|---|---|
| SEC-001 vazamento entre tenants | `isolation.test.ts` (A não altera/lista B, tenantId do cliente ignorado); 404 idêntico ao inexistente em clientes, OS, anexos, orçamentos, portal; `rls.test.ts`, `integrity.test.ts` (FK composta, A não enxerga B por SQL) | PASS | API e SQL |
| SEC-002 contornar RLS | `rls.test.ts`: papel da aplicação sem superusuário/BYPASSRLS/dono; RLS ativada e forçada em toda tabela com `tenant_id`; toda política de escrita com WITH CHECK; contexto não persiste entre transações | PASS | |
| SEC-003 escalação / mass assignment | `hardening.test.ts` (nenhum esquema Zod frouxo; nenhum uso cru de body/query/params); testes de papéis em todos os módulos; `isolation.test.ts` (gerente não cria gerente/proprietário, ninguém altera o próprio vínculo) | PASS | análise estática por teste |
| SEC-004 sessão | `auth.test.ts`: cookie HttpOnly/Secure/SameSite=Strict/`__Host-`, só o hash do token no banco, logout revoga, expiração absoluta e por inatividade, usuário desativado e empresa suspensa perdem acesso | PASS | em teste o cookie Secure é emulado; HTTPS real depende de P-01 |
| SEC-005 CSRF | `auth.test.ts` (sem token 403; token de outra sessão rejeitado); `hardening.test.ts` (Origin de outro site recusado mesmo com cookie e token válidos) | PASS | |
| SEC-006 força bruta | `auth.test.ts` (429 por IP); `hardening.test.ts` (429 por IP+conta mesmo com a senha certa, sucesso zera, janela deslizante); respostas uniformes em `auth.test.ts` | PASS | atraso progressivo não implementado; bloqueio em memória do processo (não compartilhado entre instâncias) |
| SEC-007 enumeração de token do portal | `portal.test.ts`: token aleatório/curto/ausente/expirado/revogado/substituído com o mesmo 404 e mesmo corpo; limite por IP; `grants.test.ts` (não enumera a tabela) | PASS | |
| SEC-008 aprovação fraudulenta/repetida | `quotes-decision.test.ts` (presencial: preso à versão, idempotência, decisão oposta 409, corrida, vencimento); `portal-remote.test.ts` e `portal-remote-abuse.test.ts` (remota por código: uso único, 5 tentativas, validade de 10 min, novo código invalida o anterior, 1 pedido/min e 5/h, link revogado, orçamento revisado ou já decidido, validade do orçamento, corrida × 8 rodadas, corpo estrito, sem código/e-mail nos logs); `packages/database/tests/quotes.test.ts` (CHECKs: remota sem autor e com código consumido, evento do cliente só aprova/recusa) | PASS (com ressalvas) | só testado com coletor de e-mail em memória: **nenhum envio real foi testado** (sem provedor SMTP); e-mail que cai em spam e entrega real: NOT_RUN; código de 6 dígitos com 5 tentativas e TTL de 10 min é decisão minha (não validada com o dono) |
| SEC-009 adulteração de valores | `quotes-drafts.test.ts` (total calculado no servidor, total enviado pelo cliente rejeitado, limites de desconto por papel); `quotes.test.ts` (banco: total = subtotal − desconto; versão enviada congelada até para o migrador) | PASS | |
| SEC-010 upload malicioso | `attachments.test.ts` (tipo vs conteúdo, SVG/HTML recusados, vazio e >8 MB, nome gerado pelo servidor, limite de 20); `units.test.ts` (magic bytes, chave `<uuid>/<uuid>`, não sobrescreve); `hardening.test.ts` (polyglot entregue como anexo com nosniff) | PASS | sem antivírus e sem remoção de EXIF (NOT_IMPLEMENTED) |
| SEC-011 XSS / injeção | `web.test.ts` (cabeçalhos de segurança presentes); `customers-devices.test.ts` (% e _ tratados como texto); consultas parametrizadas por Drizzle | PARCIAL | CSP verificada por cabeçalho, não por ataque real em navegador; sem DAST |
| SEC-012 SSRF | revisão de código: nenhuma chamada HTTP de saída com URL vinda do usuário. O único tráfego de saída é o SMTP para o servidor definido em `SMTP_URL` (configuração do dono) e o destinatário é sempre o e-mail já cadastrado do cliente, nunca um endereço enviado pelo portal (teste: corpo com e-mail extra → 400) | PASS (revisão) | |
| SEC-013 token em log/header | `portal.test.ts` (sem referrer, sem indexação, sem cache; token fora dos logs); `logs.test.ts` (query string, corpo e cookies fora do log) | PASS | o teste de log falhou antes da correção, confirmando o vazamento de PII em query string |
| SEC-014 acesso silencioso do Master | `master-tenants.test.ts`: nenhuma resposta do Master contém dado de cliente (nome, telefone, e-mail, texto) mesmo com um cliente cadastrado; cookie do Master não abre nenhuma rota de empresa; toda ação (suspender/reativar) grava motivo e autor na trilha DA EMPRESA; `packages/database/tests/master.test.ts` (a aplicação não tem privilégio nas tabelas do Master; só a tabela de empresas ganhou política do marcador do Master) | PARCIAL | o Master só vê situação e contagens e só suspende/reativa. **Acesso de suporte a dados de uma empresa (grant com prazo e escopo) NÃO foi construído**: não existe caminho do Master aos dados de clientes. Esse marcador de operação é uma variável de sessão que o próprio código da aplicação poderia ligar: protege contra erro de rota, não contra execução arbitrária de SQL com o papel da aplicação |
| SEC-015 dependência vulnerável | `pnpm audit` e `pnpm audit --prod` (sem vulnerabilidades conhecidas em 2026-10-31, depois de adicionar `nodemailer`); `pnpm-lock.yaml` versionado | PARCIAL | sem CI: auditoria só manual; `nodemailer` é a única dependência nova da aprovação remota |
| SEC-016 perda de dados | `pnpm backup:check` (dump, restauração em banco descartável, contagens, políticas e RLS idênticas); testes de imutabilidade (`integrity`, `quotes`, `bench`) | PARCIAL | ver `BACKUP_RECOVERY.md`: arquivos de anexo e restauração por empresa ainda não cobertos |
| SEC-017 corrida | `work-orders.test.ts` (10 aberturas simultâneas, mesma chave de idempotência, atribuições com a mesma versão); `workflow.test.ts` (duplo clique, 2 técnicos × 10 rodadas); `delivery.test.ts`; `quotes-decision.test.ts`; `isolation.test.ts` (último proprietário × 12 rodadas); `attachments.test.ts` (limite de 20 simultâneo) | PASS | ver mutações abaixo |
| SEC-018 segredos expostos | `.env` e `.env.*` ignorados, só `.env.example`; nenhum `.env`/chave/pem versionado; busca por padrões de segredo literal só encontrou senhas sintéticas de teste | PARCIAL | sem scanner dedicado (gitleaks) rodado: NOT_RUN |
| SEC-019 takeover do Master | `master.test.ts` e `master-units.test.ts`: sessão só nasce após senha E código (TOTP RFC 6238, vetores oficiais reproduzidos); código errado conta e esgota o desafio (5); desafio vence em 5 min e vale uma vez; código já usado ou de passo anterior é recusado; janela de ±30 s; sessão de 4 h / 30 min ociosa; ação sensível pede código novo (janela de 5 min); segredo MFA cifrado (AES-GCM) e senha Argon2; senha/código/cookie fora dos logs; bloqueio por IP+e-mail; rotas inexistentes sem `MASTER_ENC_KEY`; nenhuma rota HTTP cria Master | PASS (com ressalvas) | prazos curtos são proposta minha (P-45). **Sem códigos de recuperação:** quem perde o autenticador precisa de acesso ao servidor para recadastrar (script). Só há UM fator forte, sem segundo administrador obrigatório |

## Prova de que os testes de corrida pegam o defeito (teste de mutação manual)

Cada trava foi removida do código, os testes relacionados foram rodados e o arquivo restaurado com `git checkout`.

| Mutação | Resultado |
|---|---|
| protocolo: trocar o upsert travado por "ler o maior e somar 1" | MORTA (teste das 10 aberturas simultâneas falha) |
| OS: `loadOrderForActor` sem `FOR UPDATE` | MORTA (limite de 20 anexos em uploads simultâneos falha) |
| equipe: lista de proprietários sem `FOR UPDATE` | SOBREVIVEU com 1 rodada; MORTA depois de reforçar para 12 rodadas |
| assumir OS: só `lockOrderById` sem trava | SOBREVIVEU: equivalente, porque o UPDATE condicional (técnico nulo + versão) segura sozinho; é defesa em profundidade |
| assumir OS: sem trava, sem checagem prévia e sem condições do UPDATE | MORTA (os dois testes de corrida falham) |

Aprovação remota (mesma técnica, restaurando o arquivo pelo conteúdo guardado):

| Mutação | Resultado |
|---|---|
| tentativa errada não é gravada (contador nunca sobe) | MORTA |
| código não é marcado como usado | MORTA |
| não conferir se a versão do orçamento ainda está enviada | MORTA |
| não reconferir dentro da transação se o link continua ativo | **SOBREVIVEU**: a revogação antes da chamada já é pega na primeira leitura; a reconferência só protege uma corrida estreita entre as duas leituras, que nenhum teste reproduz |

Master (mesma técnica, restauração por conteúdo):

| Mutação | Resultado |
|---|---|
| aceitar código de passo já usado | MORTA (teste unitário; no banco a mesma regra existe em dobro, na função `master_challenge_complete`) |
| suspender sem exigir código recente | MORTA |
| etapa 2 aceitar qualquer código | MORTA |
| não exigir CSRF nos métodos que alteram | MORTA |
| não contar o código errado | MORTA |

Limite: são mutações escolhidas à mão nas travas de concorrência, de decisão e do Master, não uma ferramenta de mutação sobre o código inteiro.

## Não executado nesta fase

- DAST (ZAP ou similar) e varredura de portas: NOT_RUN.
- Scanner de segredos (gitleaks), CodeQL e pipeline de CI: NOT_RUN (não há `.github/workflows`).
- Teste de proxy mal configurado (`TRUST_PROXY`): NOT_RUN.
- Testes de carga e de desempenho: NOT_RUN.
- Teste de penetração por terceiro: NOT_RUN.
