# PRD — Reparo360

Versão: 0.1 (Fase 0) · Status: rascunho para aprovação do dono do produto

## 1. Problema e proposta

Assistências técnicas de eletrônicos controlam recebimento, diagnóstico, orçamento e entrega em cadernos, planilhas ou mensagens. Isso gera perda de rastreio, disputas sobre o estado do aparelho na entrada e orçamentos aprovados "de boca".

O Reparo360 é um SaaS B2B multi-tenant que registra o ciclo completo:
Recebimento → Inspeção → Diagnóstico → Orçamento → Aprovação → Reparo → Testes → Retirada → Entrega → Histórico.

## 2. Público

- **Assistência (tenant):** proprietário, gerente, atendente, técnico.
- **Consumidor:** acompanha e decide sobre o orçamento sem instalar app.
- **Plataforma (Master):** operador do Reparo360.

## 3. Ambientes

| Ambiente | Usuário | Observação MVP |
|---|---|---|
| Painel Web | equipe da assistência | rotas por papel |
| PWA da equipe | técnico/atendente | mesma base React, instalável |
| Portal do consumidor | consumidor | acesso por link individual + verificação |
| Painel Master | superadmin | MFA obrigatório, sem acesso silencioso a dados de tenant |

Premissa registrada (reversível): no MVP, painel, PWA, portal e master são **áreas de uma única aplicação React** com rotas e bundles separados, falando com **uma API Fastify**. Não são cinco deploys.

## 4. Escopo

### MVP (obrigatório)
Cadastro/configuração da assistência; autenticação e sessões; usuários e permissões; isolamento multi-tenant (API + RLS); clientes; equipamentos; inspeção/recebimento; fotos e anexos; ordens de serviço; histórico de eventos; diagnóstico; orçamento versionado; aprovação/recusa (remota verificada ou presencial); bancada; registro de reparo; checklist de testes; retirada e entrega; portal do consumidor; QR seguro; PDFs operacionais; dashboard básico; PWA instalável; Master mínimo; auditoria; backup com restauração testada; logs/monitoramento essencial; testes funcionais e de segurança.

### V2 (não implementar agora)
Estoque, financeiro, garantias especializadas, notificações automáticas, relatórios avançados, offline com sincronização, cobrança recorrente, configurações comerciais avançadas.

### V3 (não implementar agora)
Múltiplas unidades, API pública para terceiros, IA de diagnóstico, previsões, fiscal, NFC, app nativo, banco dedicado por empresa.

### PENDENTE
Ver `docs/DECISOES_PENDENTES.md`.

## 5. Requisitos funcionais (MVP)

| ID | Requisito | Prioridade |
|---|---|---|
| RF-001 | Cadastrar assistência com proprietário (onboarding transacional) | MVP |
| RF-002 | Login com sessão opaca server-side, logout e revogação | MVP |
| RF-003 | Gerir equipe (convidar, papel, desativar) | MVP |
| RF-004 | CRUD de clientes com busca e alerta de possível duplicidade | MVP |
| RF-005 | CRUD de equipamentos vinculados a cliente | MVP |
| RF-006 | Registrar recebimento: defeito relatado, estado físico, acessórios, checklist, fotos | MVP |
| RF-007 | Abrir OS com protocolo único por tenant | MVP |
| RF-008 | Atribuir técnico | MVP |
| RF-009 | Mudar estado da OS apenas via transições válidas, com evento | MVP |
| RF-010 | Registrar diagnóstico (suspeita vs. confirmado vs. inconclusivo) | MVP |
| RF-011 | Criar orçamento versionado com itens e totais calculados no servidor | MVP |
| RF-012 | Enviar orçamento; aprovar/recusar vinculado à versão | MVP |
| RF-013 | Aprovação remota com verificação do consumidor | MVP (condicionada a RF-pendente P-03) |
| RF-014 | Aprovação presencial registrada como tal | MVP |
| RF-015 | Registrar reparo (procedimento, responsável, peças descritivas, evidências) | MVP |
| RF-016 | Checklist de testes finais (aprovado/reprovado/não testado/N.A.) | MVP |
| RF-017 | Liberar retirada e registrar entrega | MVP |
| RF-018 | Gerar PDFs: recebimento, OS, orçamento, aprovação, entrega | MVP |
| RF-019 | Portal do consumidor com linha do tempo autorizada | MVP |
| RF-020 | QR da etiqueta física sem acesso automático a dados pessoais | MVP |
| RF-021 | Dashboard operacional com indicadores definidos em REGRAS_NEGOCIO | MVP |
| RF-022 | Painel Master: listar/suspender/ativar tenants, métricas técnicas | MVP |
| RF-023 | Auditoria consultável de eventos relevantes | MVP |

## 6. Requisitos não funcionais

| ID | Requisito |
|---|---|
| RNF-001 | Monólito modular TypeScript; sem microserviços |
| RNF-002 | Paginação em toda listagem; sem N+1 |
| RNF-003 | WCAG 2.2 AA nas telas do MVP |
| RNF-004 | Mobile-first no portal e na PWA |
| RNF-005 | Logs estruturados com ID de correlação, sem dados pessoais |
| RNF-006 | Backup automatizado de banco e arquivos com restauração testada |
| RNF-007 | Nenhum arquivo de código com responsabilidades não relacionadas; revisão de coesão acima de ~300 linhas |

Requisitos de segurança: ver `docs/security/THREAT_MODEL.md` (SEC-xxx).

## 7. Critérios de aceite do MVP

Os 30 critérios da especificação mestra (seção 44) são adotados integralmente. O rastreio Requisito → Implementação → Teste → Evidência será mantido a partir da Fase 1.

"Pronto para piloto" não significa "pronto para lançamento comercial amplo".

## 8. Fases

Fase 0 (esta) → 1 Fundação e segurança → 2 Clientes/equipamentos/recebimento → 3 Diagnóstico/orçamentos → 4 Reparo/entrega → 5 Interfaces/PWA → 6 Segurança/recuperação/homologação → 7 Piloto → 8 Comercialização (por partes, após validação).
