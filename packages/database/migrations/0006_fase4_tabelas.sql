CREATE TABLE "deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"work_order_id" uuid NOT NULL,
	"delivered_by" uuid NOT NULL,
	"picked_up_by_name" text NOT NULL,
	"confirmation_method" text NOT NULL,
	"items_returned" jsonb NOT NULL,
	"note" text,
	"delivered_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deliveries_one_per_order" UNIQUE("tenant_id","work_order_id"),
	CONSTRAINT "deliveries_method_ck" CHECK ("deliveries"."confirmation_method" in ('comprovante_apresentado', 'documento_conferido', 'outro'))
);
--> statement-breakpoint
CREATE TABLE "repair_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"work_order_id" uuid NOT NULL,
	"cycle" integer NOT NULL,
	"procedure" text NOT NULL,
	"parts_used" text,
	"outcome" text NOT NULL,
	"notes" text,
	"author_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "repair_tasks_outcome_ck" CHECK ("repair_tasks"."outcome" in ('concluido', 'parcial', 'sem_sucesso')),
	CONSTRAINT "repair_tasks_cycle_ck" CHECK ("repair_tasks"."cycle" >= 1)
);
--> statement-breakpoint
CREATE TABLE "test_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"work_order_id" uuid NOT NULL,
	"cycle" integer NOT NULL,
	"round" integer NOT NULL,
	"item" text NOT NULL,
	"result" text NOT NULL,
	"note" text,
	"recorded_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "test_checks_round_item_key" UNIQUE("tenant_id","work_order_id","round","item"),
	CONSTRAINT "test_checks_result_ck" CHECK ("test_checks"."result" in ('aprovado', 'reprovado', 'nao_testado', 'nao_aplicavel')),
	CONSTRAINT "test_checks_cycle_ck" CHECK ("test_checks"."cycle" >= 1 and "test_checks"."round" >= 1)
);
--> statement-breakpoint
ALTER TABLE "work_orders" ADD COLUMN "repair_cycle" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "work_orders" ADD COLUMN "test_cycle" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "work_orders" ADD COLUMN "origin_work_order_id" uuid;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_delivered_by_users_id_fk" FOREIGN KEY ("delivered_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_work_order_fk" FOREIGN KEY ("tenant_id","work_order_id") REFERENCES "public"."work_orders"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repair_tasks" ADD CONSTRAINT "repair_tasks_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repair_tasks" ADD CONSTRAINT "repair_tasks_work_order_fk" FOREIGN KEY ("tenant_id","work_order_id") REFERENCES "public"."work_orders"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_checks" ADD CONSTRAINT "test_checks_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_checks" ADD CONSTRAINT "test_checks_work_order_fk" FOREIGN KEY ("tenant_id","work_order_id") REFERENCES "public"."work_orders"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "repair_tasks_order_cycle_idx" ON "repair_tasks" USING btree ("tenant_id","work_order_id","cycle");--> statement-breakpoint
CREATE INDEX "test_checks_order_cycle_idx" ON "test_checks" USING btree ("tenant_id","work_order_id","cycle","round");--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_origin_fk" FOREIGN KEY ("tenant_id","origin_work_order_id") REFERENCES "public"."work_orders"("tenant_id","id") ON DELETE no action ON UPDATE no action;