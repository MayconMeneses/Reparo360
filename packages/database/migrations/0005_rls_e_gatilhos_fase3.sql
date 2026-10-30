-- RLS, grants mínimos e gatilhos de imutabilidade do orçamento. Migração apenas aditiva.

ALTER TABLE diagnostics ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE diagnostics FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE quote_versions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE quote_versions FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE quote_items ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE quote_items FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE quote_decisions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE quote_decisions FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

-- Append-only: diagnóstico e decisão só leem e inserem.
CREATE POLICY diagnostics_select ON diagnostics FOR SELECT USING (tenant_id = app_tenant_id());
--> statement-breakpoint
CREATE POLICY diagnostics_insert ON diagnostics FOR INSERT WITH CHECK (tenant_id = app_tenant_id());
--> statement-breakpoint
CREATE POLICY quote_decisions_select ON quote_decisions FOR SELECT USING (tenant_id = app_tenant_id());
--> statement-breakpoint
CREATE POLICY quote_decisions_insert ON quote_decisions FOR INSERT WITH CHECK (tenant_id = app_tenant_id());
--> statement-breakpoint
-- Mutáveis (sob os gatilhos abaixo): uma política FOR ALL com USING e WITH CHECK.
CREATE POLICY quote_versions_isolation ON quote_versions FOR ALL
  USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
--> statement-breakpoint
CREATE POLICY quote_items_isolation ON quote_items FOR ALL
  USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
--> statement-breakpoint

GRANT SELECT, INSERT ON diagnostics, quote_decisions TO reparo_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON quote_versions TO reparo_app;
--> statement-breakpoint
-- DELETE só existe para substituir os itens de um RASCUNHO; o gatilho barra qualquer outro caso.
GRANT SELECT, INSERT, UPDATE, DELETE ON quote_items TO reparo_app;
--> statement-breakpoint

-- Versão do orçamento: conteúdo congelado a partir do envio. Só o ciclo de vida é permitido:
--   rascunho -> enviado;  enviado -> aprovado | recusado | expirado | substituido.
-- Vale para qualquer papel do banco (inclusive o migrador): o app não é a única barreira.
CREATE FUNCTION quote_versions_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.state <> 'rascunho' THEN
      RAISE EXCEPTION 'orçamento já enviado não pode ser removido' USING ERRCODE = '55000';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.state = 'rascunho' THEN
    IF NEW.state NOT IN ('rascunho', 'enviado') THEN
      RAISE EXCEPTION 'rascunho só pode virar enviado' USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.work_order_id IS DISTINCT FROM OLD.work_order_id
     OR NEW.number IS DISTINCT FROM OLD.number
     OR NEW.subtotal_cents IS DISTINCT FROM OLD.subtotal_cents
     OR NEW.discount_cents IS DISTINCT FROM OLD.discount_cents
     OR NEW.total_cents IS DISTINCT FROM OLD.total_cents
     OR NEW.payment_terms IS DISTINCT FROM OLD.payment_terms
     OR NEW.estimated_days IS DISTINCT FROM OLD.estimated_days
     OR NEW.notes IS DISTINCT FROM OLD.notes
     OR NEW.valid_until IS DISTINCT FROM OLD.valid_until
     OR NEW.based_on_diagnostic_id IS DISTINCT FROM OLD.based_on_diagnostic_id
     OR NEW.suspicion_authorized_by IS DISTINCT FROM OLD.suspicion_authorized_by
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.submitted_by IS DISTINCT FROM OLD.submitted_by
     OR NEW.submitted_at IS DISTINCT FROM OLD.submitted_at
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'conteúdo de orçamento enviado é imutável' USING ERRCODE = '55000';
  END IF;

  IF NEW.state <> OLD.state AND NOT (OLD.state = 'enviado' AND NEW.state IN ('aprovado', 'recusado', 'expirado', 'substituido')) THEN
    RAISE EXCEPTION 'transição de estado do orçamento não permitida: % -> %', OLD.state, NEW.state USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER quote_versions_guard BEFORE UPDATE OR DELETE ON quote_versions
  FOR EACH ROW EXECUTE FUNCTION quote_versions_guard();
--> statement-breakpoint

-- Itens: só mudam enquanto a versão é rascunho. Se a versão não for visível (sem contexto de
-- empresa), o estado vem nulo e a operação é negada (falha fechada).
CREATE FUNCTION quote_items_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  parent_state text;
BEGIN
  SELECT state INTO parent_state FROM quote_versions
   WHERE tenant_id = COALESCE(NEW.tenant_id, OLD.tenant_id)
     AND id = COALESCE(NEW.quote_version_id, OLD.quote_version_id);
  IF parent_state IS DISTINCT FROM 'rascunho' THEN
    RAISE EXCEPTION 'itens de orçamento só podem mudar em rascunho' USING ERRCODE = '55000';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
--> statement-breakpoint
CREATE TRIGGER quote_items_guard BEFORE INSERT OR UPDATE OR DELETE ON quote_items
  FOR EACH ROW EXECUTE FUNCTION quote_items_guard();
