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
