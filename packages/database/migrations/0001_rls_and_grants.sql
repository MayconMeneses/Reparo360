-- Funções de contexto. NULLIF trata o valor '' que o PostgreSQL deixa em GUCs
-- personalizadas depois que um SET LOCAL é revertido numa conexão reutilizada.
CREATE FUNCTION app_tenant_id() RETURNS uuid LANGUAGE sql STABLE
  AS $$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$;
--> statement-breakpoint
CREATE FUNCTION app_user_id() RETURNS uuid LANGUAGE sql STABLE
  AS $$ SELECT NULLIF(current_setting('app.user_id', true), '')::uuid $$;
--> statement-breakpoint
CREATE FUNCTION app_session_hash() RETURNS text LANGUAGE sql STABLE
  AS $$ SELECT NULLIF(current_setting('app.session_hash', true), '') $$;
--> statement-breakpoint

-- Consulta de login: roda como dono (migrador), único caminho para achar um
-- usuário pelo e-mail antes de existir contexto. Não expõe outros campos.
CREATE FUNCTION app_login_lookup(p_email text)
  RETURNS TABLE (id uuid, password_hash text, status text)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$ SELECT u.id, u.password_hash, u.status FROM users u WHERE u.email = lower(p_email) $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_login_lookup(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_login_lookup(text) TO reparo_app;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_tenant_id(), app_user_id(), app_session_hash() TO reparo_app;
--> statement-breakpoint

ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE memberships FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE sessions FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE audit_events FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- users não tem tenant_id e é global. Sem FORCE de propósito: o dono precisa
-- ler por e-mail na função app_login_lookup. O papel da aplicação não é dono.
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- tenants: a própria empresa; sem contexto de tenant, as empresas do usuário logado.
CREATE POLICY tenants_isolation ON tenants FOR ALL
  USING (
    id = app_tenant_id()
    OR (app_tenant_id() IS NULL AND EXISTS (
      SELECT 1 FROM memberships m WHERE m.tenant_id = tenants.id AND m.user_id = app_user_id()))
  )
  WITH CHECK (id = app_tenant_id());
--> statement-breakpoint

-- memberships: o ramo por usuário só vale SEM contexto de tenant. Dentro de uma
-- requisição de tenant, um usuário que pertence a A e B não enxerga as linhas de B.
CREATE POLICY memberships_isolation ON memberships FOR ALL
  USING (
    tenant_id = app_tenant_id()
    OR (app_tenant_id() IS NULL AND user_id = app_user_id())
  )
  WITH CHECK (tenant_id = app_tenant_id());
--> statement-breakpoint

-- users: o próprio usuário ou membros da empresa ativa.
CREATE POLICY users_visibility ON users FOR ALL
  USING (
    id = app_user_id()
    OR EXISTS (SELECT 1 FROM memberships m WHERE m.user_id = users.id AND m.tenant_id = app_tenant_id())
  )
  WITH CHECK (id = app_user_id() OR app_tenant_id() IS NOT NULL);
--> statement-breakpoint

-- sessions: por tenant; antes de haver tenant, só a sessão cujo hash o servidor informou.
CREATE POLICY sessions_isolation ON sessions FOR ALL
  USING (
    tenant_id = app_tenant_id()
    OR (app_tenant_id() IS NULL AND token_hash = app_session_hash())
  )
  WITH CHECK (tenant_id = app_tenant_id());
--> statement-breakpoint

-- audit_events: append-only. Leitura só da própria empresa; escrita sem empresa
-- (ex.: login falho) é permitida, mas nunca legível pela aplicação.
CREATE POLICY audit_select ON audit_events FOR SELECT USING (tenant_id = app_tenant_id());
--> statement-breakpoint
CREATE POLICY audit_insert ON audit_events FOR INSERT
  WITH CHECK (tenant_id IS NULL OR tenant_id = app_tenant_id());
--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE ON tenants, users, memberships, sessions TO reparo_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON audit_events TO reparo_app;
