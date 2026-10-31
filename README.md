# Reparo360

**Gestão de assistências técnicas com rastreabilidade de ordens de serviço, QR Code e portal de acompanhamento.**

> **Status:** projeto em desenvolvimento e validação técnica. O sistema ainda **não está pronto para operação comercial com dados reais**, e há decisões de implantação, segurança e revisão jurídica pendentes.  
> **English:** Repair-shop management platform with work-order tracking, QR codes and a read-only customer portal. **Work in progress; not production-ready.**

## Visão rápida | Project overview

O Reparo360 foi concebido para lojas de manutenção de celulares, computadores, notebooks e outros eletrônicos. O objetivo é registrar o que foi recebido, documentar o diagnóstico, apresentar orçamentos versionados e acompanhar cada etapa até a entrega.

- **Equipe:** cadastro de clientes e equipamentos, abertura de ordem de serviço com recebimento e fotos, diagnóstico, orçamento versionado (valores digitados em reais, guardados em centavos inteiros), decisão presencial, reparo, testes finais, entrega, encerramento, documentos em PDF, etiqueta com QR Code, indicadores e gestão da equipe (somente proprietário e gerente, com confirmação de senha).
- **Consumidor:** link individual com QR Code para acompanhar o estado do serviço pelo navegador, **em modo somente leitura** nesta fase.
- **Gestão:** permissões por função, trilha de eventos e separação de dados entre empresas.
- **Evolução:** regras de negócio documentadas, testes automatizados e relatórios das fases de desenvolvimento.

## Tecnologias

| Camada | Tecnologias |
| --- | --- |
| Web | React, TypeScript, Vite, React Router |
| API | Node.js, TypeScript, Fastify, Zod |
| Dados | PostgreSQL 17, Drizzle ORM |
| Testes e qualidade | Vitest, Testing Library, axe-core, ESLint, TypeScript |
| Infraestrutura local | Docker Compose, pnpm workspaces |
| Documentos | PDFKit, QR Code |

## Engenharia e decisões técnicas

- **Monólito modular multiempresa:** separação entre API, interface, domínio e persistência.
- **Isolamento de dados:** autorização por função e políticas de Row Level Security (RLS) no PostgreSQL, com testes documentados.
- **Integridade de fluxo:** transições controladas de ordens, eventos auditáveis e tratamento de operações repetidas.
- **Portal com acesso restrito:** token individual revogável; os relatórios da fase 5 descrevem proteção de dados e limites do acesso público.
- **Qualidade verificável:** a última execução registrada nos relatórios ([fase 5](docs/reports/FASE-05-RELATORIO.md) e [fase 5B](docs/reports/FASE-05B-TELAS-OPERACAO.md)) teve 340 testes aprovados, mais as verificações de tipos, lint, build, auditoria de dependências e restauração de backup. Isso vale para aquela execução; a CI ainda não foi configurada.
- **Interface por papel:** as telas e ações mudam conforme a função (proprietário, gerente, atendente, técnico), mas quem decide é sempre o servidor.
- **Valores em dinheiro:** a pessoa digita em reais; o sistema guarda centavos inteiros para evitar erros de arredondamento e recalcula o total no servidor.

## Estrutura do repositório

```text
apps/
  api/        API e regras de aplicação
  web/        Interface, painel, bancada e portal
packages/
  domain/     Regras e contratos do domínio
  database/   Esquema, migrações e acesso aos dados
docs/
  product/       Requisitos e fluxos do produto
  architecture/  Arquitetura e modelo de dados
  security/      Modelo de ameaças e permissões
  reports/       Evidências e limites de cada fase
infra/           Ambiente local
```

## Executar verificações em ambiente de desenvolvimento

Pré-requisitos: Node.js >= 22, pnpm 11 e Docker. Necessário configurar as senhas e os caminhos do ambiente local em um arquivo `.env` **não versionado**, a partir de `.env.example`.

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

Para testes que usam banco real, prepare antes o PostgreSQL do `docker-compose.yml`, as variáveis de ambiente e as migrações conforme a configuração local. Não execute o sistema com senhas de exemplo.

## Limites conhecidos — leia antes de usar

- Aprovação ou recusa remota de orçamento pelo consumidor **não está habilitada**; o portal é somente leitura.
- Verificações de instalação real do PWA, leitura de QR em aparelho físico, Lighthouse e testes E2E automatizados ainda estão pendentes nos relatórios das fases 5 e 5B. A verificação das telas novas por papel e por tamanho de tela está em andamento.
- Existem pendências relacionadas a retenção de dados, armazenamento de arquivos, revisão jurídica, recuperação de senha e preparação para piloto.
- Não há declaração de conformidade formal com LGPD nem recomendação de uso em produção com dados pessoais reais.

Consulte [decisões pendentes](docs/DECISOES_PENDENTES.md), [modelo de ameaças](docs/security/THREAT_MODEL.md) e [relatórios de execução](docs/reports/) antes de avançar para implantação.

## Autor e projetos relacionados

Criado por **Maycon Meneses** — [GitHub](https://github.com/MayconMeneses) · [LinkedIn](https://www.linkedin.com/in/maycon-meneses/) · [Portfólio](https://mmsystem.tech/comercial).
