# Relatório — Fase 4 (Reparo, testes finais, entrega e documentos)

1. **Fase:** 4
2. **Objetivo:** registro do reparo, testes finais, liberação para retirada, entrega, encerramento, documentos operacionais e OS de retorno.
3. **Decisões aplicadas:** P-17 (encerramento manual). P-05 parcial: documentos só com dados registrados, sem cláusulas inventadas. Propostas técnicas novas: P-28 a P-31.

## Resultado dos gates

| Gate | Estado | Evidência (comando observado) |
|---|---|---|
| Typecheck | PASS | `pnpm typecheck`, saída 0 |
| Lint | PASS | `pnpm lint`, saída 0 |
| Testes de domínio | PASS | 43/43 |
| Testes de banco | PASS | 55/55 |
| Testes de API | PASS | 160/160 em 14 arquivos |
| Build | PASS | `pnpm build` gera `apps/api/dist/server.js` |
| Smoke do bundle | PASS | 17/17 passos contra `dist/server.js`: OS, diagnóstico, orçamento, reparo, testes, entrega, 5 PDFs reais (`%PDF-`), encerramento e recusa de gravação em OS encerrada |
| Limite de linhas (RNF-007) | PASS | 104 arquivos, nenhum acima de 300 |
| Auditoria de dependências | PASS | `pnpm audit`: 0 |
| Backup e restauração | PASS em execução anterior; **reconfirmação após os últimos ajustes: ver nota abaixo** | `pnpm backup:check`: 27 políticas e flags FORCE idênticas após restaurar |
| Aprovação remota (RF-013) | **BLOCKED** | depende de P-03 |
| Agendador de expiração | **NOT_RUN** | P-25 |
| E2E de interface, performance, DAST/SAST | NOT_RUN | sem interface ainda; Fase 6 |

**Total: 258 testes, 258 passaram** (43 + 55 + 160), contra PostgreSQL 17 real e dados sintéticos.

> **Nota sobre o backup:** o `backup:check` passou depois da criação das tabelas da Fase 4. Os ajustes posteriores foram só de código da API, que não afetam o esquema nem os dados. Ao tentar reexecutá-lo no fim, o Docker Desktop da máquina ficou instável e nenhum teste de banco pôde ser repetido naquele momento. A suíte completa (258) já havia passado antes dessa instabilidade. Se o Docker voltou a responder antes do commit, o resultado da reexecução está registrado na mensagem final da sessão.

## Funcionalidades entregues
- **Reparo:** tarefas append-only (procedimento, peças em texto livre, desfecho), só com a OS em reparo e presas ao ciclo de bancada.
- **Testes finais:** rodadas append-only; vale a última rodada do ciclo de testes atual. **RN-052:** aprovar exige ao menos um item aprovado, nenhum reprovado e nenhum "não testado"; rodada vazia ou só "não se aplica" nunca aprova. Reprovar exige item reprovado e motivo e devolve a OS à bancada.
- **Ciclos:** cada entrada em reparo/testes abre um ciclo novo (contador). O reparo ou o teste aprovado de uma passagem anterior **não** libera o ciclo seguinte (um teste por caminho de retorno: reprovar→reparar→testar e reabrir bancada→testar).
- **Entrega atômica:** o registro de entrega e a transição `entregar` ocorrem na mesma transação; `entregar` não existe no endpoint genérico. Acessórios devolvidos diferentes dos recebidos exigem observação. Duplo clique: uma entrega e um evento. Sem número de documento do cliente.
- **Encerramento manual** por gerente/proprietário, só depois de entregue.
- **OS encerrada ou cancelada imutável (RN-007):** anexos (envio e exclusão) agora também são recusados; um teste percorre todos os endpoints de escrita nos dois estados terminais.
- **Retorno ou reclamação:** nova OS com `origin_work_order_id`, só a partir de OS entregue/encerrada, mesma empresa e mesmo equipamento.
- **Documentos em PDF:** ordem de serviço, orçamento (só versões enviadas; versão substituída e expirada saem com faixa de aviso), registro de decisão (diz "presencial" e quem decidiu, nunca sugere decisão remota), comprovante de entrega (diz que não registra pagamento nem quitação). Todos com "não é documento fiscal". Valores formatados a partir de centavos inteiros.

## Defeitos encontrados e corrigidos
- **Ordem das checagens:** as pré-condições por registro (ex.: testes aprováveis) rodavam antes de conferir estado e papel, devolvendo mensagem enganosa (`TESTES_NAO_APROVAVEIS` numa OS recém-recebida). Corrigido: estado e papel primeiro (`assertTransitionAllowed`). O mesmo defeito existia na entrega (aviso de acessórios antes de "OS não está pronta") e foi corrigido, com teste de regressão.
- **RN-007 tinha lacuna:** anexos podiam ser enviados e excluídos em OS encerrada/cancelada. Corrigido e coberto.
- Teste da Fase 3 que afirmava que as ações da Fase 4 eram "indisponíveis" foi **atualizado** para o novo comportamento (não enfraquecido): entrega e ações do orçamento seguem recusadas; as demais obedecem à tabela de estados.
- Falhas de **teste**, corrigidas na causa: `Title` do PDF com acento é gravado em UTF-16 (o teste agora confere o `Subject`); trecho morto num teste de OS encerrada removido.

## Segurança verificada (por teste)
- Reparo, testes e entrega: append-only para a aplicação (SQLSTATE 42501 em UPDATE/DELETE), RLS forçada com `WITH CHECK`, FKs compostas por empresa, CHECKs de resultado/desfecho/método/ciclo.
- OS de retorno: banco recusa origem de outra empresa (23503) e a OS apontar para si mesma (23514).
- Todos os documentos: 403 para técnico, 404 para outra empresa (igual a inexistente), 401 sem sessão. O telefone do cliente não aparece no orçamento, no registro de decisão nem no comprovante de entrega.
- Ciclo completo (passos 1 a 21 da especificação) em um único teste, com os papéis reais de cada etapa, que confere a sequência exata de eventos, todos com autor.

## Desvios e limitações (declarados)
- **P-29:** o técnico não emite nenhum PDF (todos trazem telefone do cliente). A matriz previa a "ordem de serviço" para ele; seria preciso uma versão sem contato.
- **P-30:** documentos são gerados sob demanda; **não são guardados nem versionados** (`generated_documents` não existe). Cada emissão é auditada, mas o arquivo emitido não é arquivado.
- **P-28:** os métodos de confirmação da retirada são uma proposta técnica, não validada com assistências reais.
- **P-05:** conteúdo dos documentos não revisado por advogado; elementos do CDC no orçamento seguem sem verificação jurídica.
- **RF-013 BLOQUEADO (P-03)** e **agendador de expiração NOT_RUN (P-25)**: inalterados.
- Peças são texto livre (estoque é V2). Evidências do reparo são os anexos da OS, sem vínculo direto à tarefa.
- Os testes de concorrência (entrega, assumir OS, transições) verificam o resultado, mas **não houve teste de mutação**.
- Desempenho e geração de PDF não foram medidos. Fotos mantêm EXIF/GPS (P-23). Arquivos não entram no backup (P-22). Adaptador S3 não implementado (P-02).

## Pendências herdadas (inalteradas)
S3/MinIO, backup de arquivos, EXIF/malware, órfãos, recuperação de senha (P-03/P-21), rate limit compartilhado (P-20), CI/CD, DAST/SAST, OpenAPI, projeto dentro do OneDrive.

## Riscos residuais
Sem aprovação remota, portal do consumidor e QR (Fase 5), o consumidor ainda não acessa nada. O backend cobre todo o ciclo da assistência, mas não há interface.

## Próximos passos
Fase 5: dashboard (indicadores com fórmula/fonte), painel web e PWA, portal do consumidor e QR (QR e portal dependem de P-03 para decisões remotas). Antes, decidir a stack de interface e o desenho do design system.

**Status: PENDENTE** — nenhum gate reprovou e os 258 testes passam, mas RF-013 está BLOQUEADO, o agendador está NOT_RUN, o backup precisa de reconfirmação final e há desvios declarados (P-29, P-30). A fase aguarda sua revisão. Não é "APROVADA".
