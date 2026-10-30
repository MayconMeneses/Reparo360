# Matriz de controle de acesso

Aplicada no backend, por permissão. Ocultar botão no frontend não é controle. Consumidor não tem papel de tenant: acessa via grant de portal, restrito às próprias OS.

Legenda: ✔ permitido · ◐ permitido com restrição (nota) · — negado. SA = superadmin da plataforma, P = proprietário, G = gerente, A = atendente, T = técnico.

| Permissão | SA | P | G | A | T | Nota |
|---|---|---|---|---|---|---|
| `platform.tenant.manage` | ✔ | — | — | — | — | MFA obrigatório |
| `platform.tenant.read_metadata` | ✔ | — | — | — | — | só metadados; nunca dados operacionais |
| `platform.support_access.grant` | — | ✔ | — | — | — | tenant autoriza, com prazo e escopo |
| `platform.support_access.use` | ◐ | — | — | — | — | só com grant ativo; auditado |
| `team.manage` | — | ✔ | ◐ | — | — | G não altera P nem cria outro G |
| `tenant.settings.write` | — | ✔ | ◐ | — | — | G: só configuração operacional |
| `customer.create` / `customer.update` | — | ✔ | ✔ | ✔ | — | |
| `customer.read` | — | ✔ | ✔ | ✔ | ◐ | T: só clientes de OS atribuídas |
| `device.create` / `device.update` | — | ✔ | ✔ | ✔ | — | |
| `device.read` | — | ✔ | ✔ | ✔ | ◐ | T: só de OS atribuídas |
| `work_order.create` | — | ✔ | ✔ | ✔ | — | |
| `work_order.read` | — | ✔ | ✔ | ✔ | ◐ | T: atribuídas (ou da fila, se P-12 liberar) |
| `work_order.assign` | — | ✔ | ✔ | ◐ | — | A: só na abertura |
| `work_order.transition` | — | ✔ | ✔ | ◐ | ◐ | conforme coluna Papéis em FLUXOS.md |
| `work_order.cancel` | — | ✔ | ✔ | — | — | motivo obrigatório |
| `intake.write` | — | ✔ | ✔ | ✔ | — | |
| `diagnostic.write` | — | ✔ | ✔ | — | ◐ | T: OS atribuída |
| `quote.create` / `quote.update_draft` | — | ✔ | ✔ | ✔ | ◐ | T: se P-13 liberar |
| `quote.submit` | — | ✔ | ✔ | ✔ | — | |
| `quote.manage` (revisar/substituir) | — | ✔ | ✔ | ✔ | — | |
| `quote.discount.above_limit` | — | ✔ | ◐ | — | — | limite por P-10 |
| `quote.decision.in_person` | — | ✔ | ✔ | ✔ | — | rotulada presencial |
| `repair.update` | — | ✔ | ✔ | — | ◐ | T: OS atribuída |
| `test_checklist.write` | — | ✔ | ✔ | — | ◐ | T: OS atribuída |
| `delivery.register` | — | ✔ | ✔ | ✔ | — | |
| `attachment.upload` | — | ✔ | ✔ | ✔ | ◐ | T: OS atribuída |
| `attachment.read` | — | ✔ | ✔ | ✔ | ◐ | T: OS atribuída |
| `attachment.delete` | — | ✔ | ✔ | — | — | exclusão lógica, auditada |
| `document.generate` | — | ✔ | ✔ | ✔ | ◐ | T: só ordem de serviço |
| `report.operational.read` | — | ✔ | ✔ | — | — | |
| `audit.read` | ◐ | ✔ | ◐ | — | — | G: eventos operacionais, não de segurança |
| `data.export` | — | ✔ | — | — | — | reautenticação |

## Regras transversais
- Negar por padrão: permissão ausente é negada.
- Recurso de outro tenant responde 404, igual a recurso inexistente (sem enumeração).
- Operações sensíveis (`team.manage`, `data.export`, grants de suporte, ações SA) exigem reautenticação recente.
- Consumidor: apenas leitura da própria OS (campos autorizados) e `quote.decision.remote` na versão vigente, após verificação.
- Mudança de papel invalida sessões do usuário afetado.

## Testes derivados
Cada linha gera ao menos um teste positivo e um negativo por papel (CT-AC-xxx), mais testes cruzados entre Assistência A e B.
