# Backup e recuperação

Estado em 2026-10-31. Só vale o que está marcado como verificado.

## O que existe e foi verificado
- `pnpm backup:check` (`scripts/backup-restore-check.mjs`): faz dump do banco de teste, restaura em um banco descartável e compara contagens por tabela, número de políticas e flags de RLS. Última execução: PASS.
- Observação: rodado ao mesmo tempo que a suíte da API, o script deu FAIL porque o banco mudou entre o dump e a conferência. Rode sempre isolado.

## O que NÃO está coberto (lacunas reais)
1. **Arquivos de anexo** ficam no disco (`STORAGE_DIR`), fora do dump do banco. O script não copia nem restaura esses arquivos e não confere se cada `attachments.storage_key` tem arquivo. Um backup só do banco deixa anexos órfãos. NOT_IMPLEMENTED.
2. **Restauração por empresa** (restaurar só a empresa A sem tocar na B) não foi provada. NOT_RUN.
3. **Criptografia e imutabilidade do backup** (exigidas por SEC-016) dependem de onde o backup é guardado: decisão P-14 / hospedagem P-01. NOT_IMPLEMENTED.
4. **RPO e RTO** (quanto de dado se aceita perder e em quanto tempo se volta) ficam em aberto em P-14. Sem esses números não há meta a verificar.
5. **Teste periódico de restauração** não está agendado; só roda manualmente.

## Procedimento manual (banco)
1. `pg_dump` no formato custom com o papel dono (migrador), nunca com o papel da aplicação.
2. Restaurar em banco novo (`createdb` + `pg_restore`), subir a API apontando para ele e rodar `pnpm backup:check` como conferência.
3. Copiar `STORAGE_DIR` junto, no mesmo instante lógico do dump (aceita-se pequena diferença; arquivos novos sem linha no banco são inofensivos, linha sem arquivo não).
4. Conferir que a aplicação conecta com o papel `reparo_app` (NOBYPASSRLS) depois da restauração.
