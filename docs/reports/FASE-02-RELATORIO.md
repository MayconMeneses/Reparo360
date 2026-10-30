# Relatório — Fase 2 (Clientes, equipamentos e recebimento)

1. **Fase:** 2
2. **Objetivo:** clientes, equipamentos, inspeção de recebimento, anexos privados, protocolo, abertura de OS, comprovante em PDF e histórico.
3. **Commit/branch:** nenhum commit da Fase 2 (aguardando autorização). Última referência: `b4d341e` (Fases 0 e 1).
4. **Decisões aplicadas:** P-07 (protocolo sequencial por empresa e ano), P-08 (só a marca "senha informada"). P-02 parcial (ver limitações).

## Resultado dos gates

| Gate | Estado | Evidência (comando observado) |
|---|---|---|
| Typecheck | PASS | `pnpm typecheck`, saída 0 |
| Lint | PASS | `pnpm lint`, saída 0 |
| Testes de domínio | PASS | 18/18 |
| Testes de banco (RLS, FKs, CHECKs, privilégios) | PASS | 33/33 |
| Testes de API | PASS | 84/84 em 7 arquivos |
| Build | PASS | `pnpm build` gera `apps/api/dist/server.js` |
| Smoke do bundle (ponta a ponta) | PASS | 11/11 passos contra `dist/server.js` (cadastro, login, cliente, equipamento, OS, upload, download, PDF, listagem, logout, sessão revogada); arquivos gravados com nome UUID |
| Limite de linhas (RNF-007) | PASS | 71 arquivos, nenhum acima de 300 |
| Backup e restauração | PASS | 12 tabelas, 15 políticas e flags FORCE idênticas após restaurar (banco de teste) |
| Auditoria de dependências | PASS | `pnpm audit`: 0 (após adicionar `pdfkit`) |
| Adaptador S3 / MinIO | **NOT_RUN** | não implementado |
| E2E de interface, performance, DAST/SAST | NOT_RUN | sem interface; previstos para a Fase 6 |

**Total: 135 testes, 135 passaram**, contra PostgreSQL 17 real, dados sintéticos.

## Funcionalidades entregues
- **Clientes:** cadastro, edição, busca (nome/telefone, curingas tratados como texto), paginação estável, alerta de possível duplicidade sem fusão automática.
- **Equipamentos:** por cliente, IMEI com dígito verificador (Luhn), categorias fechadas; o proprietário do equipamento não é editável.
- **OS e recebimento:** abertura transacional (OS + inspeção + evento + auditoria), protocolo `AAAA-NNNNNN`, checklist com `nao_testado` como estado explícito, atribuição de técnico com controle de versão (409 em conflito), listagem e detalhe.
- **Idempotência:** `Idempotency-Key` no `POST /work-orders` (duplo clique devolve a mesma OS, sem consumir protocolo).
- **Anexos:** upload binário com validação por assinatura (JPEG/PNG/WebP/PDF), limite de 8 MB e 20 por OS, download só via API autorizada, exclusão lógica.
- **Comprovante de recebimento (PDF):** dados do recebimento, "senha informada: sim/não", rodapé "não é documento fiscal", sem cláusulas jurídicas inventadas.
- **Papéis:** atendente opera o balcão; técnico só vê OS atribuídas e sem telefone/e-mail do cliente; gerente atribui e exclui anexos.

## Defeitos encontrados pelos testes e corrigidos
- **Anexo excluído continuava aparecendo no detalhe da OS** (consulta sem filtro de `deleted_at`). Corrigido.
- **`LocalDiskStorage.get` lançava de forma síncrona** em vez de rejeitar a Promise. Corrigido (`async`).
- Do projeto: nenhuma falha de isolamento entre empresas foi encontrada nesta fase.
- Falhas do **teste** (não do produto), corrigidas na causa: busca da "senha" casava com o telefone (`…1234`); o formato real de `Title`/`Subject` do pdfkit é objeto indireto.

## Segurança verificada (por teste)
- FKs compostas recusam, no banco, vínculo entre empresas e entre clientes de uma mesma empresa (SQLSTATE 23503).
- RLS com `FORCE` em todas as tabelas com `tenant_id`; teste de catálogo exige RLS e `WITH CHECK` nas políticas de escrita.
- Eventos da OS e recebimento são imutáveis para a aplicação (42501); em anexos só `deleted_at`/`deleted_by` podem mudar.
- Recurso de outra empresa e recurso inexistente respondem com o mesmo 404; técnico em OS não atribuída também.
- Upload: conteúdo divergente do tipo declarado, SVG, HTML e executável são recusados (415); autenticação e CSRF acontecem **antes** de ler o corpo.
- Chave de armazenamento só aceita `<uuid>/<uuid>`; travessia de diretório e caminhos absolutos são recusados; nunca sobrescreve arquivo.
- Concorrência: 10 aberturas simultâneas geram 10 protocolos consecutivos; mesma chave de idempotência em paralelo gera 1 OS e nenhuma lacuna; 24 uploads simultâneos respeitam o limite de 20; duas atribuições com a mesma versão resultam em 1 sucesso e 1 conflito.
- Virada de ano testada com relógio injetado (31/12 às 22h de Brasília ainda é o ano que termina).

## Limitações e o que NÃO foi feito
- **P-02 incompleto:** só há adaptador de **disco local privado** (`STORAGE_DIR`, fora do OneDrive). **S3/MinIO não foi implementado nem testado.** Não use disco local em produção multi-instância.
- **Arquivos não entram no backup.** `backup:check` cobre só o banco. Spec 24.2 (backup compatível com as referências do banco) está **pendente**.
- **Arquivos órfãos:** se a transação falhar depois da gravação o arquivo é removido, mas esse caminho **não tem teste** e uma queda do processo entre gravar e confirmar pode deixar órfão. Não há varredura (P-22).
- **EXIF/GPS não são removidos** das fotos e não há verificação de malware (P-23). Spec 22.3 **não está atendida** neste ponto.
- **QR Code** não implementado (Fase 5). **Fila de OS sem técnico** (P-12) adiada para a Fase 3.
- **Comprovante** não é persistido nem versionado (`generated_documents` não criada) e não traz cláusulas legais (P-24/P-05).
- Nomes fora do WinAnsi (emoji, cirílico, etc.) saem como `?` no PDF; não há fonte TTF embutida.
- Checklist com nomes livres (sem modelos por categoria). Atribuição só a técnicos (papel `tecnico`); proprietário que também conserta não pode ser atribuído.
- Busca de cliente usa `ILIKE '%...%'` sem índice trigram; **desempenho não foi medido**.
- Rate limit continua só no login/reautenticação/cadastro; demais rotas sem limite por IP (P-20).
- Testes de concorrência verificam o invariante, mas **não foi feito teste de mutação** (não confirmado que falham sem as travas).
- O `drizzle-kit` gerou as migrações 0002 e 0003; a 0003 é escrita à mão (RLS e grants) e foi revisada linha a linha.

## Pendências herdadas da Fase 1 (inalteradas)
Recuperação de senha (P-03/P-21), rate limit compartilhado (P-20), CI/CD, DAST/SAST, OpenAPI, projeto dentro do OneDrive (`node_modules`/`dist`).

## Riscos residuais
Dados pessoais (nome, telefone) trafegam em PDF e anexos sem criptografia em repouso (disco local). Exige decisão de hospedagem (P-01) e retenção (P-15) antes de dados reais.

## Próximos passos
Fase 3: máquina de estados da OS (transições, papéis, concorrência), diagnóstico, orçamento versionado e aprovação. Antes, decidir P-03 (canal de verificação do consumidor), P-09, P-10, P-11 e P-13.

**Status: PENDENTE** — nenhum gate reprovou e os 135 testes passam, mas há itens NOT_RUN e limitações acima (S3, backup de arquivos, EXIF), e a fase aguarda sua revisão. Não é "APROVADA".
