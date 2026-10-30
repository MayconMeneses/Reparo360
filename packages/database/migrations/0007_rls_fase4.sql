-- RLS e grants mínimos das tabelas da Fase 4. Todas append-only para a aplicação. Migração apenas aditiva.

ALTER TABLE work_orders ADD CONSTRAINT work_orders_origin_ck
  CHECK (origin_work_order_id IS NULL OR origin_work_order_id <> id);
--> statement-breakpoint
ALTER TABLE work_orders ADD CONSTRAINT work_orders_cycles_ck CHECK (repair_cycle >= 0 AND test_cycle >= 0);
--> statement-breakpoint

ALTER TABLE repair_tasks ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE repair_tasks FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE test_checks ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE test_checks FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE deliveries ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE deliveries FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY repair_tasks_select ON repair_tasks FOR SELECT USING (tenant_id = app_tenant_id());
--> statement-breakpoint
CREATE POLICY repair_tasks_insert ON repair_tasks FOR INSERT WITH CHECK (tenant_id = app_tenant_id());
--> statement-breakpoint
CREATE POLICY test_checks_select ON test_checks FOR SELECT USING (tenant_id = app_tenant_id());
--> statement-breakpoint
CREATE POLICY test_checks_insert ON test_checks FOR INSERT WITH CHECK (tenant_id = app_tenant_id());
--> statement-breakpoint
CREATE POLICY deliveries_select ON deliveries FOR SELECT USING (tenant_id = app_tenant_id());
--> statement-breakpoint
CREATE POLICY deliveries_insert ON deliveries FOR INSERT WITH CHECK (tenant_id = app_tenant_id());
--> statement-breakpoint

GRANT SELECT, INSERT ON repair_tasks, test_checks, deliveries TO reparo_app;
