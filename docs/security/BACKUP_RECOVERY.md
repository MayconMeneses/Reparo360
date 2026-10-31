# Backup e recuperação

Estado em 2026-10-31. Só vale o que está marcado como verificado.

## O que existe e foi verificado
- `pnpm backup:check` (`scripts/backup-restore-check.mjs`): faz dump do banco de teste, restaura em um banco descartável e compara contagens por tabela, número de políticas e flags de RLS. Última execução: PASS.
- Observação: rodado ao mesmo tempo que a suíte da API, o script deu FAIL porque o banco mudou entre o dump e a conferência. Rode sempre isolado.

## Backup completo (banco + anexos) — `pnpm backup`
- Gera `backups/completo-<banco>-<data>/` com `banco.dump`, a pasta `anexos/` e `manifesto.json` (SHA-256 do dump e de cada anexo, contagens por tabela). Nunca sobrescreve.
- Na hora, confere que **todo anexo registrado no banco** (inclusive excluído logicamente) existe na cópia com o tamanho e o SHA-256 gravados no banco; arquivos sem registro são avisados (órfãos) e copiados.
- `pnpm backup:verify backups/<pasta>`: confere o manifesto, restaura o dump num banco descartável (sem tocar no real) e compara as contagens. Reprova backup adulterado, anexo alterado ou removido.
- Testado por `apps/api/tests/backup.test.ts` (6 testes) e por mutação (4 de 4 mortas).
- Para o sistema instalado, o banco é `reparo360_dev` e os anexos ficam em `STORAGE_DIR` do `.env`.

## O que NÃO está coberto (lacunas reais)
1. ~~Anexos fora do backup~~ **Resolvido** por `pnpm backup` (acima). Continua: a cópia fica no mesmo computador até você levá-la a outro lugar; não há agendamento automático.
2. **Restauração por empresa** (restaurar só a empresa A sem tocar na B): **NOT_IMPLEMENTED**. A restauração é do banco inteiro; restaurar uma empresa exigiria uma ferramenta própria de exportação e reimportação por tenant.
3. **Criptografia e imutabilidade do backup** (exigidas por SEC-016): o backup **não é criptografado**. Guarde-o em disco criptografado (BitLocker) ou em local protegido; imutabilidade depende de onde for guardado (P-14 / P-01). NOT_IMPLEMENTED.
4. **RPO e RTO** (quanto de dado se aceita perder e em quanto tempo se volta) ficam em aberto em P-14. Sem esses números não há meta a verificar.
5. **Teste periódico de restauração** não está agendado; só roda manualmente.

## Procedimento manual (banco)
1. `pg_dump` no formato custom com o papel dono (migrador), nunca com o papel da aplicação.
2. Restaurar em banco novo (`createdb` + `pg_restore`), subir a API apontando para ele e rodar `pnpm backup:check` como conferência.
3. Copiar `STORAGE_DIR` junto, no mesmo instante lógico do dump (aceita-se pequena diferença; arquivos novos sem linha no banco são inofensivos, linha sem arquivo não).
4. Conferir que a aplicação conecta com o papel `reparo_app` (NOBYPASSRLS) depois da restauração.
