CREATE TABLE "password_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"purpose" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "password_tokens_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "password_tokens_purpose_ck" CHECK ("password_tokens"."purpose" in ('redefinicao', 'convite'))
);
--> statement-breakpoint
ALTER TABLE "password_tokens" ADD CONSTRAINT "password_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "password_tokens_user_idx" ON "password_tokens" USING btree ("user_id","created_at");--> statement-breakpoint

-- Tokens de redefinição de senha e de convite. A aplicação NÃO tem privilégio algum sobre a tabela (nem SELECT):
-- tudo passa pelas funções abaixo (SECURITY DEFINER, REVOKE de PUBLIC, GRANT só à aplicação). RLS ligada sem política.
ALTER TABLE password_tokens ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON password_tokens FROM PUBLIC;
--> statement-breakpoint

-- Emite um token de REDEFINIÇÃO para uma conta ativa. Sem conta, conta inativa ou limite por hora atingido: devolve zero
-- linhas (quem chama responde igual nos três casos, para não revelar se o e-mail existe).
CREATE FUNCTION pw_token_issue(p_email text, p_hash text, p_expires timestamptz, p_now timestamptz, p_max_per_hour integer)
  RETURNS TABLE (out_name text, out_email text)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
DECLARE v_user uuid; v_count integer;
BEGIN
  SELECT u.id, u.name, u.email INTO v_user, out_name, out_email FROM users u WHERE u.email = lower(p_email) AND u.status = 'ativo';
  IF v_user IS NULL THEN RETURN; END IF;
  SELECT count(*) INTO v_count FROM password_tokens t
    WHERE t.user_id = v_user AND t.purpose = 'redefinicao' AND t.created_at > p_now - interval '1 hour';
  IF v_count >= p_max_per_hour THEN RETURN; END IF;
  INSERT INTO password_tokens (user_id, token_hash, purpose, expires_at, created_at) VALUES (v_user, p_hash, 'redefinicao', p_expires, p_now);
  RETURN NEXT;
END $$;
--> statement-breakpoint

-- Token de CONVITE: só para conta recém-criada e ainda travada (must_change_password), nunca para conta já em uso.
CREATE FUNCTION pw_token_invite(p_user uuid, p_hash text, p_expires timestamptz, p_now timestamptz) RETURNS boolean
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
BEGIN
  PERFORM 1 FROM users u WHERE u.id = p_user AND u.status = 'ativo' AND u.must_change_password;
  IF NOT FOUND THEN RETURN false; END IF;
  INSERT INTO password_tokens (user_id, token_hash, purpose, expires_at, created_at) VALUES (p_user, p_hash, 'convite', p_expires, p_now);
  RETURN true;
END $$;
--> statement-breakpoint

-- Consome o token e troca a senha NA MESMA transação: uso único (UPDATE condicional), validade conferida, outros tokens da
-- conta invalidados e TODAS as sessões da conta, em todas as empresas, revogadas. Devolve o id da conta, ou nulo.
CREATE FUNCTION pw_token_consume(p_hash text, p_new_hash text, p_now timestamptz) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
DECLARE v_user uuid; r record;
BEGIN
  UPDATE password_tokens SET used_at = p_now
    WHERE token_hash = p_hash AND used_at IS NULL AND expires_at > p_now RETURNING user_id INTO v_user;
  IF v_user IS NULL THEN RETURN NULL; END IF;
  UPDATE users SET password_hash = p_new_hash, must_change_password = false, updated_at = p_now WHERE id = v_user AND status = 'ativo';
  IF NOT FOUND THEN RAISE EXCEPTION 'usuario_inativo' USING ERRCODE = 'P0001'; END IF;
  UPDATE password_tokens SET used_at = p_now WHERE user_id = v_user AND used_at IS NULL;
  PERFORM set_config('app.user_id', v_user::text, true);
  FOR r IN SELECT m.tenant_id AS tid FROM memberships m WHERE m.user_id = v_user LOOP
    PERFORM set_config('app.tenant_id', r.tid::text, true);
    UPDATE sessions s SET revoked_at = p_now WHERE s.user_id = v_user AND s.revoked_at IS NULL;
  END LOOP;
  PERFORM set_config('app.tenant_id', '', true);
  PERFORM set_config('app.user_id', '', true);
  RETURN v_user;
END $$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION pw_token_issue(text, text, timestamptz, timestamptz, integer),
  pw_token_invite(uuid, text, timestamptz, timestamptz), pw_token_consume(text, text, timestamptz) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION pw_token_issue(text, text, timestamptz, timestamptz, integer),
  pw_token_invite(uuid, text, timestamptz, timestamptz), pw_token_consume(text, text, timestamptz) TO reparo_app;
