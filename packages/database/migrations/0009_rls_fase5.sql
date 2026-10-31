-- RLS e grants do link do consumidor. Migração apenas aditiva.

ALTER TABLE customer_access_grants ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE customer_access_grants FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE FUNCTION app_grant_hash() RETURNS text LANGUAGE sql STABLE
  AS $$ SELECT NULLIF(current_setting('app.grant_hash', true), '') $$;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_grant_hash() TO reparo_app;
--> statement-breakpoint

-- Com contexto de empresa: tudo da empresa. Sem contexto: SOMENTE a linha cujo hash o servidor informou
-- (é o caminho do consumidor, que chega sem sessão). Depois da leitura, o servidor passa a usar o
-- contexto da empresa do link para ler os dados da OS. Escrita só dentro da empresa.
CREATE POLICY grants_isolation ON customer_access_grants FOR ALL
  USING (
    tenant_id = app_tenant_id()
    OR (app_tenant_id() IS NULL AND token_hash = app_grant_hash())
  )
  WITH CHECK (tenant_id = app_tenant_id());
--> statement-breakpoint

GRANT SELECT, INSERT ON customer_access_grants TO reparo_app;
--> statement-breakpoint
-- Revogação é a única alteração possível; token, validade e OS ficam imutáveis.
GRANT UPDATE (revoked_at) ON customer_access_grants TO reparo_app;
