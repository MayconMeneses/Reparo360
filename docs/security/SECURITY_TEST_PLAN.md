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
| SEC-016 perda de dados | `pnpm backup:check` (dump, restauração em banco descartável); **`pnpm backup` + `pnpm backup:verify`** (banco + anexos + manifesto SHA-256; `backup.test.ts`: confere cada anexo contra o SHA-256 do banco, acusa anexo ausente e corrompido (inclusive de mesmo tamanho), detecta backup adulterado, avisa órfãos, nunca sobrescreve); testes de imutabilidade (`integrity`, `quotes`, `bench`) | PARCIAL | **backup sem criptografia, sem cópia externa automática e sem retenção; restauração só do banco inteiro (por empresa: NOT_IMPLEMENTED)**; RPO/RTO em aberto (P-14) |
| SEC-017 corrida | `work-orders.test.ts` (10 aberturas simultâneas, mesma chave de idempotência, atribuições com a mesma versão); `workflow.test.ts` (duplo clique, 2 técnicos × 10 rodadas); `delivery.test.ts`; `quotes-decision.test.ts`; `isolation.test.ts` (último proprietário × 12 rodadas); `attachments.test.ts` (limite de 20 simultâneo) | PASS | ver mutações abaixo |
| SEC-018 segredos expostos | `.env` e `.env.*` ignorados, só `.env.example`; **gitleaks no histórico completo (14 commits): 14 achados, todos valores sintéticos em arquivos de teste (senhas fictícias, chave de teste, semente pública da RFC 6238); `.gitleaks.toml` libera só isso e o histórico fica limpo; controle negativo: segredo plantado em `apps/api/src` é apontado e o mesmo tipo de valor em teste não** | PASS (com ressalvas) | só o histórico do Git foi varrido (não o disco, onde o `.env` real fica ignorado); a varredura roda de novo no CI (`.github/workflows/ci.yml`), mas o CI ainda não foi executado |
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

## Adendo: senha temporária e criação de empresa pelo Master
- `master-create.test.ts` (11 testes): exige código recente; o Master não escolhe a senha (campo de senha → 400); e-mail repetido → 409 sem empresa pela metade; senha temporária fora de log, auditoria e banco (só hash Argon2); dono com senha temporária só acessa `/me`, sair e trocar a senha (demais rotas → 403 `TROCA_DE_SENHA_OBRIGATORIA`); troca recusa senha atual errada, nova curta ou igual; troca libera o sistema, invalida a temporária e encerra as outras sessões; contas normais não são afetadas.
- Mutações (4 de 4 mortas): guarda deixa de bloquear; troca não tira a marca; troca não encerra outras sessões; criar empresa sem código recente.
- Limites: ver P-46 (o Master conhece a senha temporária até a troca; sem prazo de validade).

## Adendo: proxy, CI, desempenho
- **TRUST_PROXY** (`proxy.test.ts`, 4 testes): desligado, trocar o `X-Forwarded-For` a cada tentativa NÃO escapa do limite de login e a auditoria guarda o IP da conexão; ligado, o IP do cabeçalho passa a valer (por isso só se liga atrás de um proxy que reescreva o cabeçalho). PASS.
- **CI** (`.github/workflows/ci.yml`, `codeql.yml`): escritos e validados com o `actionlint` (sem avisos), **mas NOT_RUN**: só rodam no GitHub depois do envio. O CodeQL exige "Code scanning" habilitado no repositório. As ações usam tags de versão (`@v4`, `@v3`), não SHA fixo.
- **Desempenho** (`scripts/perf-measure.mjs`, 20 mil clientes, 20 mil equipamentos, 30 mil OS, 120 mil eventos, uma empresa, esta máquina): ver `docs/reports/FASE-06-RELATORIO.md`. Defeito encontrado e corrigido: o dashboard lia todo o histórico de eventos e falhava (422) acima de 200 mil eventos.
- Mutações novas: backup (4 de 4 mortas) e dashboard (1 morta; 1 sobrevivente equivalente: remover o filtro de período apenas desliga a otimização e não muda o resultado).
- **DAST (ZAP): NOT_RUN** (imagem grande e varredura contra servidor local ainda não montada; decisão pendente).

## Adendo: CI, backup cifrado e DAST
- **CI no GitHub (primeira execução, commit bef0570):** CodeQL passou. O job de qualidade falhou em `pnpm test` e o de segredos falhou no gitleaks. Causas encontradas e corrigidas: (1) o gitleaks apontava 3 senhas fictícias no próprio CI e no script de medição (liberação estreita adicionada, histórico limpo e controle negativo mantido); (2) `pnpm test` rodava os pacotes em paralelo contra o mesmo banco de teste (agora `--workspace-concurrency=1`); (3) os testes da interface com análise de acessibilidade estouravam o limite de 5 s do vitest (agora 30 s). **A causa exata no GitHub não pôde ser lida (os logs exigem login)**: (2) e (3) são as hipóteses que reproduzi localmente; a confirmação só vem da próxima execução.
- **Backup cifrado** (`backup-encrypted.test.ts`): nada em claro na pasta, senha errada/ausente recusada, byte alterado detectado (banco e anexo), `--encrypt` sem senha ou com senha curta recusado. 4 mutações mortas.
- **DAST (OWASP ZAP 2.17, linha de base passiva, anônima)** — `scripts/dast-baseline.mjs`, contra a API e a interface compiladas em `localhost`: 0 falhas, 6 avisos, 62 verificações limpas. Avisos: CSP com `https:` genérico em `style-src`/`font-src` e `unsafe-inline` em estilos (médio), Permissions-Policy ausente, COEP ausente, cache de conteúdo estático, comentário suspeito em JS. **Corrigido:** CSP agora `style-src 'self'` (+ `style-src-attr 'unsafe-inline'` só para atributos `style=`), `font-src 'self'`, Permissions-Policy definida; verificado em navegador real (login e portal, sem violações). **Depois da correção (nova varredura): 0 falhas, 4 avisos (um de risco baixo: COEP; três informativos), 64 verificações limpas; nenhum alerta médio.** **Restam por decisão:** `unsafe-inline` em atributos de estilo (a interface usa 97 `style=`; remover exige refatorar), COEP, cache de arquivos estáticos (são arquivos com hash no nome).
- **Limites do DAST:** não autenticado e passivo (não ataca nem testa as áreas de dentro do sistema), HTTP local sem HTTPS, banco de teste. Não substitui teste de invasão.

## Resultado do CI no GitHub (commit 61a2beb, 2026-10-31)
**Verde:** job de qualidade (tipos, lint, tamanho de arquivos, build, testes com PostgreSQL em Linux, `pnpm audit` e `--prod`) e job de segredos (gitleaks no histórico completo). O CodeQL passou na primeira execução (commit bef0570).
Foram precisas 4 execuções para chegar aí; o que o CI encontrou e eu corrigi:
1. **Defeito real de portabilidade:** o backup falhava no Linux (`cpSync` recusa copiar para uma pasta de destino que já existe; no Windows passava). Reproduzido num contêiner Linux e corrigido.
2. **Defeito de teste:** o teste da troca de senha respondia `{}` para o Dashboard e quebrava a tela quando o app abria o Dashboard (só aparecia em máquina mais lenta).
3. `pnpm test` na raiz rodava os pacotes em paralelo contra o mesmo banco (agora em sequência) e o limite de 5 s do vitest estourava nos testes de acessibilidade (agora 30 s).
4. gitleaks: senhas e chave de teste fictícias em arquivos novos (liberação estreita por arquivo e por linha, com controle negativo).
**Limites:** os logs do GitHub exigem login; as falhas foram lidas pelas anotações públicas. As ações usam tags de versão (não SHA). O CI não roda os testes de instalador (Windows), a interface em navegador real nem o DAST.

## Adendo: recuperação de senha e convite por e-mail
- `password-reset.test.ts` (16) e `password-invite.test.ts` (10), `packages/database/tests/passwords.test.ts` (3), `web: pages/password-pages.test.tsx`. Cobrem: link montado só com `PUBLIC_URL` (cabeçalhos `Host`/`X-Forwarded-Host` forjados não mudam o link); resposta **idêntica** para conta existente, inexistente, desativada, envio que falha e envio desligado; limite por conta (3 por hora) e por IP+e-mail sem mudar a resposta; envio **depois** de responder; token de uso único, com validade (30 min; convite 72 h), consumo atômico (corrida × 8 rodadas, exatamente um vence), outros tokens da conta invalidados e **todas as sessões da conta revogadas em todas as empresas**; senha fraca recusada antes de gastar o token; conta do Master não é afetada; token nunca na resposta do convite, nunca nos logs; e-mail já existente mantém o 409 e não recebe link; convite só para conta nova e travada.
- A aplicação não tem privilégio algum na tabela de tokens; o banco só aceita as três funções restritas (catálogo testado).
- **Mutações:** 7 nas funções SQL (uso único, validade, revogação de sessões, invalidação de outros tokens, convite para conta em uso, limite por hora, conta desativada) — 7 mortas; 4 no código — 3 mortas e 1 sobrevivente equivalente (verificação de tamanho do token repetida de propósito pelo esquema de entrada); 1 combinada que faz o token vazar na resposta do convite — morta.
- **Limites:** nunca testado com provedor de e-mail real; o IP e o limite por conta ficam em memória do processo (P-42); não há auditoria do *pedido* de redefinição (só da troca concluída), porque a função não devolve o id da conta; "enumeração por tempo" foi tratada (mesmo trabalho nos dois caminhos), mas não medida com instrumento.

## Adendo: testes de navegador
Ver `docs/product/RASTREABILIDADE.md`. Achado: o recarregamento automático da página na primeira visita (service worker assumindo o controle) apagava o login digitado — **corrigido** (a página só recarrega quando a pessoa pede a atualização).
