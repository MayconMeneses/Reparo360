# Relatório — Fase 1 (Fundação técnica e segurança)

1. **Fase:** 1
2. **Objetivo:** monorepo, banco com migrações e RLS, identidade (sessões, Argon2id, permissões), API Fastify com contexto de tenant, logs, testes de isolamento A×B e backup inicial.
3. **Escopo entregue:** `packages/domain` (papéis e permissões), `packages/database` (schema, 2 migrações, `withContext`), `apps/api` (onboarding, login, logout, reautenticação, `/me`, gestão de equipe, health), scripts de qualidade e de backup.
4. **Commit/branch:** repositório Git inicializado localmente (`main`). **Nada foi commitado nem publicado.**
5. **Auditoria do ambiente:** Docker Desktop estava parado e foi iniciado; imagem `postgres:17.6-alpine` (digest `sha256:ef257d85f76e48da1c64832459b59fcaba1a4dac97bf5d7450c77753542eee94`); porta do Postgres mapeada só em `127.0.0.1:54329`.

## Resultado dos gates

| Gate | Estado | Evidência (comando observado) |
|---|---|---|
| Typecheck (domain, database, api) | PASS | `pnpm typecheck`, saída 0 |
| Lint | PASS | `pnpm lint`, "No issues found" |
| Testes de domínio | PASS | 8/8 |
| Testes de banco (RLS) | PASS | 19/19 |
| Testes de API | PASS | 32/32 (auth 19, isolamento/permissões 13) |
| Build | PASS | `pnpm build` gera `apps/api/dist/server.js` |
| Smoke do bundle | PASS | bundle em porta 3917: `/health` 200, `/health/ready` 200 (consulta o banco), `/api/v1/me` sem sessão 401, cadastro desabilitado 403, sem segredos no log |
| Limite de linhas (RNF-007) | PASS | `pnpm loc:check`: 37 arquivos, nenhum acima de 300 (maior: 190) |
| Backup e restauração | PASS | `pnpm backup:check`: contagens, 6 políticas RLS e flags FORCE idênticas após `pg_restore` em banco descartável |
| Auditoria de dependências | PASS | `pnpm audit`: 0 vulnerabilidades (ver item 10) |
| Testes E2E / performance | NOT_RUN | não há interface nem fluxo de negócio ainda |
| DAST / SAST (CodeQL, ZAP) | NOT_RUN | previstos para a Fase 6 |
| CI/CD | NOT_RUN | pipeline não criado nesta fase |

Teste total: **59 testes, 59 passaram**, rodando contra PostgreSQL 17 real em container, com dados sintéticos.

## Decisões técnicas
- TypeScript fixado em **5.9.3**: `typescript-eslint` 8.72 declara suporte a `<6.1.0`; o TS 7.0.2 ("latest") não é suportado pelo lint.
- `vitest` **5.0.5** e override do `esbuild` (ver item 10).
- RLS com `FORCE` em `tenants`, `memberships`, `sessions`, `audit_events`. `users` tem RLS ativa **sem FORCE** de propósito: a função `app_login_lookup` (SECURITY DEFINER, dona = migrador) precisa achar o usuário por e-mail antes de existir contexto. O papel da aplicação não é dono, então a RLS vale para ele.
- Ramo "por usuário" de `memberships`/`tenants` só vale **sem** contexto de tenant (usuário em A e B não vê B numa requisição de A).
- Cookie `__Host-r360_session`, `HttpOnly; Secure; SameSite=Strict; Path=/`; token de 256 bits, só o SHA-256 vai ao banco; CSRF por token no cabeçalho; sessão com validade absoluta de 12 h e inatividade de 2 h; vínculo, usuário e empresa são revalidados a cada requisição.
- Argon2id explícito (19 MiB, 2 iterações, 1 thread); login com verificação descartável quando o e-mail não existe.
- Schemas Zod `strict`: campo não declarado (`tenantId`, `role`, `status`) é rejeitado.

## Erros encontrados e corrigidos
- `pnpm install` retornou código 1 sem erro de dependência: o pnpm 11 bloqueia scripts de build; liberado apenas `esbuild`.
- Smoke test inicial **inválido**: a porta 3000 estava ocupada por outro projeto da máquina; refeito em porta livre.
- **Corrida real em `updateMember`**: o `FOR UPDATE` só travava a linha do alvo; dois proprietários rebaixando um ao outro passariam ambos. Corrigido travando todas as linhas de proprietário em ordem fixa antes de contar.
- Teste de auditoria esperava "permission denied" na mensagem do Drizzle; a causa real fica em `cause` (código 42501). Teste ajustado para checar o código do PostgreSQL, sem afrouxar.
- Fixtures com e-mail em maiúsculas contra API que normaliza para minúsculas: corrigido no helper.

## 10. Vulnerabilidades
`pnpm audit` achou 6 (2 críticas, 4 moderadas), **todas em desenvolvimento** (`vitest`/`tinypool`/`@vitest/mocker` e `esbuild` antigo do `drizzle-kit`); `pnpm audit --prod` já dava 0. Corrigidas: `vitest` 5.0.5 e override `esbuild >=0.25.12`. Reauditoria: 0.

## Funcionalidades preservadas
Não aplicável (primeira fase com código).

## Limitações e o que NÃO foi verificado
- O teste de concorrência de proprietários garante o invariante (≤1 sucesso, ≥1 proprietário ativo), mas **não foi verificado que ele falha sem a correção** (sem teste de mutação).
- Igualdade de **tempo** entre "e-mail inexistente" e "senha errada" não foi medida; só a igualdade do corpo e do status.
- **Atomicidade do onboarding** não tem teste: sob FORCE RLS não há como contar empresas órfãs sem superusuário. Está correta por construção (uma transação), mas NOT_RUN.
- O backup foi exercitado só no banco de **teste**, com poucas linhas sintéticas. Sem criptografia, sem cópia externa, sem retenção, sem agendamento. RPO/RTO não definidos (P-14).
- Rate limit em memória, por IP, instância única; sem bloqueio por conta (P-20).
- Sem checagem de `Origin` além de SameSite + token CSRF.
- Cadastro de membro usa senha inicial provisória (P-18); 409 de e-mail revela existência (P-19).
- Auditoria de login não registra tentativa com `actor` (e-mail não é gravado, de propósito).
- A pasta do projeto está dentro do **OneDrive**; a instalação funcionou sem EPERM, mas `node_modules`/`dist` sincronizando é risco de lentidão e conflito. Recomendado excluir essas pastas da sincronização ou mover o projeto.

## Pendências explícitas (fora desta fase ou bloqueadas)
- Recuperação de senha: **BLOCKED** por P-03/P-21 (sem canal de envio).
- MFA do Master e Painel Master: não pertencem a esta fase.
- OpenAPI: não gerado.
- CI/CD, DAST, SAST, ADRs formais: Fase 6 / a criar.
- Decisões P-01 a P-21 em `docs/DECISOES_PENDENTES.md`.

## Riscos residuais
Matriz de permissões da Fase 0 só cobre `team.manage`, `tenant.settings.write`, `audit.read`, `data.export` em código; as demais entram com seus módulos. Nenhum dado real foi usado.

## Próximos passos
Revisão sua; depois Fase 2 (clientes, equipamentos, recebimento, anexos, protocolo, comprovante). Recomendo antes decidir P-02 (storage de arquivos) e P-07/P-08 (protocolo, senha do aparelho).

**Status: PENDENTE** — nenhum gate crítico reprovou e todos os executados passaram, mas há itens em NOT_RUN e limitações acima, e a fase aguarda sua revisão. Não é "APROVADA".
