# Arquitetura (Fase 0)

## Decisão central
Monólito modular multi-tenant, TypeScript ponta a ponta. Um processo de API, um PostgreSQL compartilhado, um bucket privado S3-compatível, uma aplicação web com áreas separadas. Escalar só com métrica que justifique.

## Stack alvo (versões a confirmar na Fase 1 com a documentação oficial)
React + Vite + TypeScript; Fastify + OpenAPI + Zod; PostgreSQL + Drizzle; S3-compatível privado; Vitest, Playwright; Docker para desenvolvimento.

Ambiente verificado em 2026-10-30: Node v24.20.0, npm 11.19.0, pnpm 11.24.0, git 2.55.0, Docker 29.8.2. `psql` não está instalado localmente; o PostgreSQL de desenvolvimento rodará em container.

## Estrutura inicial (criar só o que a fase usar)
```
apps/api        Fastify: composição, plugins, rotas finas
apps/web        React: painel, PWA, portal e master como áreas/rotas
packages/contracts   schemas Zod compartilhados e tipos de erro
packages/domain      regras puras: máquina de estados, cálculo de orçamento, permissões
packages/database    schema Drizzle, migrações, políticas RLS
docs/ tests/ infra/
```
Monorepo pnpm workspaces. `packages/ui` só nasce na Fase 5 se houver componentes reutilizados de fato.

## Camadas e dependência
`apps/api/routes → application (casos de uso) → domain (puro) ` e `application → database (repositórios)`. Domínio não importa Fastify, Drizzle nem React. Regra verificada por teste de dependência (sem ciclos) na CI.

## Módulos de backend
`identity`, `tenancy`, `customers`, `devices`, `work-orders`, `intake`, `diagnostics`, `quotes`, `repairs`, `attachments`, `documents`, `customer-access`, `audit`, `platform-admin`. Cada módulo é criado quando seu primeiro fluxo real é implementado.

## Contexto de tenant
1. Sessão resolve usuário e tenant ativo no servidor.
2. Cada requisição abre transação e executa `SET LOCAL app.tenant_id`.
3. Toda consulta passa por essa transação; RLS é a segunda barreira, a autorização por recurso é a primeira.
4. Teste de regressão cobre conexão reutilizada sem vazamento de contexto.

## Qualidade e modularidade (RNF-007)
Verificação por comando: script de contagem de linhas por arquivo com alerta acima de 300 e lista de justificativas aceitas. Revisão de coesão manual nos acima do limite.

## Fora desta fase
Nenhum código de aplicação. Fase 1 começa após aprovação deste pacote e das decisões P-01 a P-04.
