-- RLS, grants mínimos e CHECKs retroativos. Migração apenas aditiva.

-- CHECKs nas tabelas da Fase 1: sem isso um bug poderia gravar qualquer texto em papel/status.
ALTER TABLE memberships ADD CONSTRAINT memberships_role_ck
  CHECK (role IN ('proprietario', 'gerente', 'atendente', 'tecnico'));
--> statement-breakpoint
ALTER TABLE memberships ADD CONSTRAINT memberships_status_ck CHECK (status IN ('ativo', 'desativado'));
--> statement-breakpoint
ALTER TABLE users ADD CONSTRAINT users_status_ck CHECK (status IN ('ativo', 'desativado'));
--> statement-breakpoint
ALTER TABLE tenants ADD CONSTRAINT tenants_status_ck
  CHECK (status IN ('em_configuracao', 'em_teste', 'ativa', 'suspensa', 'cancelada'));
--> statement-breakpoint

-- RLS ligada e forçada em todas as tabelas novas.
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE customers FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE devices ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE devices FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE protocol_counters ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE protocol_counters FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE work_orders ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE work_orders FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE intake_inspections ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE intake_inspections FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE work_order_events ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE work_order_events FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE attachments ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE attachments FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

-- Tabelas mutáveis: uma política FOR ALL com USING e WITH CHECK (impede mover linha para outro tenant).
CREATE POLICY customers_isolation ON customers FOR ALL
  USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
--> statement-breakpoint
CREATE POLICY devices_isolation ON devices FOR ALL
  USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
--> statement-breakpoint
CREATE POLICY protocol_counters_isolation ON protocol_counters FOR ALL
  USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
--> statement-breakpoint
CREATE POLICY work_orders_isolation ON work_orders FOR ALL
  USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
--> statement-breakpoint
CREATE POLICY attachments_isolation ON attachments FOR ALL
  USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
--> statement-breakpoint

-- Tabelas append-only: políticas separadas de leitura e inserção, sem UPDATE/DELETE.
CREATE POLICY intake_select ON intake_inspections FOR SELECT USING (tenant_id = app_tenant_id());
--> statement-breakpoint
CREATE POLICY intake_insert ON intake_inspections FOR INSERT WITH CHECK (tenant_id = app_tenant_id());
--> statement-breakpoint
CREATE POLICY events_select ON work_order_events FOR SELECT USING (tenant_id = app_tenant_id());
--> statement-breakpoint
CREATE POLICY events_insert ON work_order_events FOR INSERT WITH CHECK (tenant_id = app_tenant_id());
--> statement-breakpoint

-- Grants mínimos para o papel da aplicação.
GRANT SELECT, INSERT, UPDATE ON customers, devices, protocol_counters, work_orders TO reparo_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON intake_inspections, work_order_events, attachments TO reparo_app;
--> statement-breakpoint
-- Exclusão lógica de anexo: só estas duas colunas podem ser alteradas.
GRANT UPDATE (deleted_at, deleted_by) ON attachments TO reparo_app;
