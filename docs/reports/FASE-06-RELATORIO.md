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
