CREATE TABLE "platform_admins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"password_hash" text NOT NULL,
	"totp_secret_enc" text NOT NULL,
	"totp_last_step" bigint DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'ativo' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_admins_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "platform_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_challenges_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "platform_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"admin_id" uuid NOT NULL,
	"csrf_token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_auth_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"ip" text,
	"user_agent" text,
	CONSTRAINT "platform_sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "audit_events" ADD COLUMN "reason" text;--> statement-breakpoint
ALTER TABLE "platform_challenges" ADD CONSTRAINT "platform_challenges_admin_id_platform_admins_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."platform_admins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_sessions" ADD CONSTRAINT "platform_sessions_admin_id_platform_admins_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."platform_admins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "platform_challenges_admin_idx" ON "platform_challenges" USING btree ("admin_id");--> statement-breakpoint
CREATE INDEX "platform_sessions_admin_idx" ON "platform_sessions" USING btree ("admin_id");--> statement-breakpoint

-- Master: a aplicação NÃO tem privilégio algum sobre as tabelas platform_* (nem SELECT). Todo acesso é por
-- funções SECURITY DEFINER abaixo, cada uma com REVOKE de PUBLIC e GRANT só ao papel da aplicação.
-- RLS ativada sem política (sem FORCE: o dono, que executa as funções, precisa ler); o papel da aplicação não é dono.
ALTER TABLE platform_admins ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE platform_challenges ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE platform_sessions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON platform_admins, platform_challenges, platform_sessions FROM PUBLIC;
--> statement-breakpoint

-- As funções do Master listam e suspendem empresas sem ler dados de clientes: ligam este marcador só durante
-- a própria execução. Só leitura e alteração da própria linha da empresa (nenhuma outra tabela ganha política).
CREATE POLICY tenants_master_read ON tenants FOR SELECT
  USING (current_setting('app.master_op', true) = 'on');
--> statement-breakpoint
CREATE POLICY tenants_master_update ON tenants FOR UPDATE
  USING (current_setting('app.master_op', true) = 'on')
  WITH CHECK (current_setting('app.master_op', true) = 'on');
--> statement-breakpoint

CREATE FUNCTION master_session_admin(p_hash text, p_now timestamptz) RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$ SELECT s.admin_id FROM platform_sessions s JOIN platform_admins a ON a.id = s.admin_id
        WHERE s.token_hash = p_hash AND s.revoked_at IS NULL AND s.expires_at > p_now AND a.status = 'ativo' $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION master_session_admin(text, timestamptz) FROM PUBLIC;
--> statement-breakpoint

CREATE FUNCTION master_login_lookup(p_email text)
  RETURNS TABLE (id uuid, password_hash text, status text)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$ SELECT a.id, a.password_hash, a.status FROM platform_admins a WHERE a.email = lower(p_email) $$;
--> statement-breakpoint

CREATE FUNCTION master_create_challenge(p_admin uuid, p_hash text, p_expires timestamptz, p_ip text) RETURNS void
  LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$ INSERT INTO platform_challenges (admin_id, token_hash, expires_at, ip) VALUES (p_admin, p_hash, p_expires, p_ip) $$;
--> statement-breakpoint

CREATE FUNCTION master_challenge_get(p_hash text, p_now timestamptz)
  RETURNS TABLE (challenge_id uuid, admin_id uuid, attempts integer, totp_secret_enc text, totp_last_step bigint)
  LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$ SELECT c.id, c.admin_id, c.attempts, a.totp_secret_enc, a.totp_last_step
        FROM platform_challenges c JOIN platform_admins a ON a.id = c.admin_id
        WHERE c.token_hash = p_hash AND c.consumed_at IS NULL AND c.expires_at > p_now AND a.status = 'ativo'
        FOR UPDATE OF c $$;
--> statement-breakpoint

CREATE FUNCTION master_challenge_fail(p_id uuid) RETURNS void
  LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$ UPDATE platform_challenges SET attempts = attempts + 1 WHERE id = p_id $$;
--> statement-breakpoint

-- Consome o desafio, grava o passo TOTP (só se for MAIOR que o último aceito: anti-repetição) e cria a sessão.
CREATE FUNCTION master_challenge_complete(
  p_id uuid, p_step bigint, p_session_hash text, p_csrf text, p_expires timestamptz, p_ip text, p_ua text, p_now timestamptz
) RETURNS boolean
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
DECLARE v_admin uuid;
BEGIN
  UPDATE platform_challenges SET consumed_at = p_now WHERE id = p_id AND consumed_at IS NULL RETURNING admin_id INTO v_admin;
  IF v_admin IS NULL THEN RETURN false; END IF;
  UPDATE platform_admins SET totp_last_step = p_step, updated_at = p_now
    WHERE id = v_admin AND totp_last_step < p_step AND status = 'ativo';
  IF NOT FOUND THEN RETURN false; END IF;
  INSERT INTO platform_sessions (token_hash, admin_id, csrf_token, expires_at, ip, user_agent, created_at, last_seen_at, last_auth_at)
    VALUES (p_session_hash, v_admin, p_csrf, p_expires, p_ip, p_ua, p_now, p_now, p_now);
  RETURN true;
END $$;
--> statement-breakpoint

CREATE FUNCTION master_session_get(p_hash text, p_now timestamptz)
  RETURNS TABLE (session_id uuid, admin_id uuid, email text, name text, csrf_token text, last_seen_at timestamptz, last_auth_at timestamptz, expires_at timestamptz)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$ SELECT s.id, s.admin_id, a.email, a.name, s.csrf_token, s.last_seen_at, s.last_auth_at, s.expires_at
        FROM platform_sessions s JOIN platform_admins a ON a.id = s.admin_id
        WHERE s.token_hash = p_hash AND s.revoked_at IS NULL AND s.expires_at > p_now AND a.status = 'ativo' $$;
--> statement-breakpoint

CREATE FUNCTION master_session_touch(p_hash text, p_now timestamptz) RETURNS void
  LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$ UPDATE platform_sessions SET last_seen_at = p_now WHERE token_hash = p_hash AND revoked_at IS NULL $$;
--> statement-breakpoint

CREATE FUNCTION master_session_revoke(p_hash text, p_now timestamptz) RETURNS void
  LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$ UPDATE platform_sessions SET revoked_at = p_now WHERE token_hash = p_hash AND revoked_at IS NULL $$;
--> statement-breakpoint

CREATE FUNCTION master_totp_material(p_hash text, p_now timestamptz)
  RETURNS TABLE (totp_secret_enc text, totp_last_step bigint)
  LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$ SELECT a.totp_secret_enc, a.totp_last_step FROM platform_admins a WHERE a.id = master_session_admin(p_hash, p_now) $$;
--> statement-breakpoint

-- Reautenticação com novo código: também só vale se o passo for maior que o último aceito.
CREATE FUNCTION master_reauth(p_hash text, p_step bigint, p_now timestamptz) RETURNS boolean
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
DECLARE v_admin uuid;
BEGIN
  v_admin := master_session_admin(p_hash, p_now);
  IF v_admin IS NULL THEN RETURN false; END IF;
  UPDATE platform_admins SET totp_last_step = p_step, updated_at = p_now WHERE id = v_admin AND totp_last_step < p_step;
  IF NOT FOUND THEN RETURN false; END IF;
  UPDATE platform_sessions SET last_auth_at = p_now WHERE token_hash = p_hash;
  RETURN true;
END $$;
--> statement-breakpoint

-- Lista empresas: metadados e CONTAGENS. Nenhum dado de cliente, equipamento ou OS sai daqui.
CREATE FUNCTION master_list_tenants(p_hash text, p_now timestamptz)
  RETURNS TABLE (t_id uuid, t_name text, t_trade_name text, t_status text, t_created_at timestamptz, t_members bigint, t_work_orders bigint)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
DECLARE r record; m bigint; w bigint;
BEGIN
  IF master_session_admin(p_hash, p_now) IS NULL THEN RAISE EXCEPTION 'sessao_invalida' USING ERRCODE = '28000'; END IF;
  PERFORM set_config('app.master_op', 'on', true);
  FOR r IN SELECT x.id AS rid, x.name AS rname, x.trade_name AS rtrade, x.status AS rstatus, x.created_at AS rcreated FROM tenants x ORDER BY x.created_at, x.id LOOP
    PERFORM set_config('app.tenant_id', r.rid::text, true);
    SELECT count(*) INTO m FROM memberships mm WHERE mm.tenant_id = r.rid AND mm.status = 'ativo';
    SELECT count(*) INTO w FROM work_orders wo WHERE wo.tenant_id = r.rid;
    t_id := r.rid; t_name := r.rname; t_trade_name := r.rtrade; t_status := r.rstatus; t_created_at := r.rcreated; t_members := m; t_work_orders := w;
    RETURN NEXT;
  END LOOP;
  PERFORM set_config('app.tenant_id', '', true);
  PERFORM set_config('app.master_op', '', true);
END $$;
--> statement-breakpoint

-- Suspende ou reativa. cancelada fica de fora (retenção de dados exige decisão). Registra na trilha DA EMPRESA.
CREATE FUNCTION master_set_tenant_status(p_hash text, p_now timestamptz, p_tenant uuid, p_status text, p_reason text, p_corr text, p_ip text)
  RETURNS text
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
DECLARE v_admin uuid; v_current text;
BEGIN
  v_admin := master_session_admin(p_hash, p_now);
  IF v_admin IS NULL THEN RAISE EXCEPTION 'sessao_invalida' USING ERRCODE = '28000'; END IF;
  IF p_status NOT IN ('ativa', 'suspensa') THEN RETURN 'transicao_invalida'; END IF;
  PERFORM set_config('app.master_op', 'on', true);
  SELECT x.status INTO v_current FROM tenants x WHERE x.id = p_tenant FOR UPDATE;
  IF NOT FOUND THEN PERFORM set_config('app.master_op', '', true); RETURN 'nao_encontrada'; END IF;
  IF v_current = 'cancelada' OR v_current = p_status OR (p_status = 'ativa' AND v_current <> 'suspensa') THEN
    PERFORM set_config('app.master_op', '', true);
    RETURN 'transicao_invalida';
  END IF;
  UPDATE tenants SET status = p_status, updated_at = p_now WHERE id = p_tenant;
  PERFORM set_config('app.tenant_id', p_tenant::text, true);
  INSERT INTO audit_events (tenant_id, actor_user_id, action, target_type, target_id, outcome, correlation_id, ip, reason)
    VALUES (p_tenant, v_admin, 'master_tenant_' || p_status, 'tenant', p_tenant::text, 'ok', p_corr, p_ip, p_reason);
  PERFORM set_config('app.tenant_id', '', true);
  PERFORM set_config('app.master_op', '', true);
  RETURN 'ok';
END $$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION master_login_lookup(text), master_create_challenge(uuid, text, timestamptz, text),
  master_challenge_get(text, timestamptz), master_challenge_fail(uuid),
  master_challenge_complete(uuid, bigint, text, text, timestamptz, text, text, timestamptz),
  master_session_get(text, timestamptz), master_session_touch(text, timestamptz), master_session_revoke(text, timestamptz),
  master_totp_material(text, timestamptz), master_reauth(text, bigint, timestamptz),
  master_list_tenants(text, timestamptz), master_set_tenant_status(text, timestamptz, uuid, text, text, text, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION master_login_lookup(text), master_create_challenge(uuid, text, timestamptz, text),
  master_challenge_get(text, timestamptz), master_challenge_fail(uuid),
  master_challenge_complete(uuid, bigint, text, text, timestamptz, text, text, timestamptz),
  master_session_get(text, timestamptz), master_session_touch(text, timestamptz), master_session_revoke(text, timestamptz),
  master_totp_material(text, timestamptz), master_reauth(text, bigint, timestamptz),
  master_list_tenants(text, timestamptz), master_set_tenant_status(text, timestamptz, uuid, text, text, text, text) TO reparo_app;
