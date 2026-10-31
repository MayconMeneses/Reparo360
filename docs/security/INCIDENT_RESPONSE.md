# Resposta a incidentes (rascunho operacional)

Sem prazos legais: os prazos de comunicação à ANPD e aos titulares (LGPD) não foram conferidos em fonte oficial e dependem de revisão jurídica. Pendente (ver `DECISOES_PENDENTES.md`).

## Classificar
- **Crítico**: acesso entre empresas confirmado, dados pessoais expostos, segredo vazado, dado apagado ou corrompido.
- **Alto**: tentativa em massa de login, falha de autorização sem exposição confirmada.
- **Médio/baixo**: erro isolado sem dado de terceiros.

## Primeiros passos
1. Registrar hora (UTC), quem detectou e o ID de correlação (`x-correlation-id`) das requisições envolvidas. Os logs não guardam corpo, cookie nem query string, então o ID é o elo.
2. Conter: suspender a empresa afetada (bloqueia login e sessões abertas), revogar sessões, desativar o link do portal (`customer_access.manage`), trocar segredos expostos.
3. Preservar: copiar logs e `audit_events` (append-only) da janela do incidente antes de qualquer correção.
4. Avaliar alcance consultando a auditoria por empresa; não alterar dados para "consertar" antes de preservar.
5. Corrigir pela causa, com teste que reproduza o problema (regra do projeto: o teste deve falhar antes e passar depois).
6. Comunicar conforme revisão jurídica (pendente) e registrar o pós-incidente: causa, impacto, correção, teste novo.

## Limites atuais
- Não há alertas automáticos nem monitoramento externo (NOT_IMPLEMENTED).
- Não há painel Master para suspender empresa pela interface; a suspensão hoje é por banco (NOT_IMPLEMENTED).
- Não há contato de plantão definido (decisão do dono).
