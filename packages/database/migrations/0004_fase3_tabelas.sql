CREATE TABLE "diagnostics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"work_order_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"nature" text NOT NULL,
	"symptoms" text NOT NULL,
	"checks_performed" text NOT NULL,
	"findings" text,
	"recommended_services" text,
	"notes" text,
	"author_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "diagnostics_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "diagnostics_order_revision_key" UNIQUE("tenant_id","work_order_id","revision"),
	CONSTRAINT "diagnostics_nature_ck" CHECK ("diagnostics"."nature" in ('suspeita', 'confirmado', 'inconclusivo')),
	CONSTRAINT "diagnostics_findings_ck" CHECK ("diagnostics"."nature" = 'inconclusivo' or "diagnostics"."findings" is not null)
);
--> statement-breakpoint
CREATE TABLE "quote_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"quote_version_id" uuid NOT NULL,
	"decision" text NOT NULL,
	"channel" text NOT NULL,
	"decided_by" uuid NOT NULL,
	"confirmed_by_name" text NOT NULL,
	"note" text,
	"part_unavailable" boolean DEFAULT false NOT NULL,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quote_decisions_one_per_version" UNIQUE("tenant_id","quote_version_id"),
	CONSTRAINT "quote_decisions_decision_ck" CHECK ("quote_decisions"."decision" in ('aprovado', 'recusado')),
	CONSTRAINT "quote_decisions_channel_ck" CHECK ("quote_decisions"."channel" in ('presencial', 'remoto'))
);
--> statement-breakpoint
CREATE TABLE "quote_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"quote_version_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"kind" text NOT NULL,
	"description" text NOT NULL,
	"quantity" integer NOT NULL,
	"unit_price_cents" bigint NOT NULL,
	CONSTRAINT "quote_items_version_position_key" UNIQUE("tenant_id","quote_version_id","position"),
	CONSTRAINT "quote_items_kind_ck" CHECK ("quote_items"."kind" in ('peca', 'servico')),
	CONSTRAINT "quote_items_values_ck" CHECK ("quote_items"."quantity" > 0 and "quote_items"."quantity" <= 1000 and "quote_items"."unit_price_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "quote_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"work_order_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"state" text DEFAULT 'rascunho' NOT NULL,
	"subtotal_cents" bigint DEFAULT 0 NOT NULL,
	"discount_cents" bigint DEFAULT 0 NOT NULL,
	"total_cents" bigint DEFAULT 0 NOT NULL,
	"payment_terms" text,
	"estimated_days" integer,
	"notes" text,
	"valid_until" timestamp with time zone,
	"based_on_diagnostic_id" uuid,
	"suspicion_authorized_by" uuid,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_by" uuid NOT NULL,
	"submitted_by" uuid,
	"submitted_at" timestamp with time zone,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quote_versions_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "quote_versions_order_number_key" UNIQUE("tenant_id","work_order_id","number"),
	CONSTRAINT "quote_versions_state_ck" CHECK ("quote_versions"."state" in ('rascunho', 'enviado', 'aprovado', 'recusado', 'expirado', 'substituido')),
	CONSTRAINT "quote_versions_money_ck" CHECK ("quote_versions"."subtotal_cents" >= 0 and "quote_versions"."discount_cents" >= 0 and "quote_versions"."discount_cents" <= "quote_versions"."subtotal_cents" and "quote_versions"."total_cents" = "quote_versions"."subtotal_cents" - "quote_versions"."discount_cents"),
	CONSTRAINT "quote_versions_days_ck" CHECK ("quote_versions"."estimated_days" is null or "quote_versions"."estimated_days" > 0),
	CONSTRAINT "quote_versions_sent_ck" CHECK ("quote_versions"."state" = 'rascunho' or ("quote_versions"."valid_until" is not null and "quote_versions"."payment_terms" is not null and "quote_versions"."estimated_days" is not null and "quote_versions"."based_on_diagnostic_id" is not null and "quote_versions"."submitted_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "work_order_events" ALTER COLUMN "actor_user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "diagnostics" ADD CONSTRAINT "diagnostics_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diagnostics" ADD CONSTRAINT "diagnostics_work_order_fk" FOREIGN KEY ("tenant_id","work_order_id") REFERENCES "public"."work_orders"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_decisions" ADD CONSTRAINT "quote_decisions_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_decisions" ADD CONSTRAINT "quote_decisions_version_fk" FOREIGN KEY ("tenant_id","quote_version_id") REFERENCES "public"."quote_versions"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_items" ADD CONSTRAINT "quote_items_version_fk" FOREIGN KEY ("tenant_id","quote_version_id") REFERENCES "public"."quote_versions"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_versions" ADD CONSTRAINT "quote_versions_suspicion_authorized_by_users_id_fk" FOREIGN KEY ("suspicion_authorized_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_versions" ADD CONSTRAINT "quote_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_versions" ADD CONSTRAINT "quote_versions_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_versions" ADD CONSTRAINT "quote_versions_work_order_fk" FOREIGN KEY ("tenant_id","work_order_id") REFERENCES "public"."work_orders"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_versions" ADD CONSTRAINT "quote_versions_diagnostic_fk" FOREIGN KEY ("tenant_id","based_on_diagnostic_id") REFERENCES "public"."diagnostics"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "quote_versions_one_open_per_order" ON "quote_versions" USING btree ("tenant_id","work_order_id") WHERE "quote_versions"."state" in ('rascunho', 'enviado');--> statement-breakpoint
CREATE INDEX "quote_versions_due_idx" ON "quote_versions" USING btree ("tenant_id","state","valid_until");--> statement-breakpoint
ALTER TABLE "work_order_events" ADD CONSTRAINT "events_actor_ck" CHECK ("work_order_events"."actor_user_id" is not null or "work_order_events"."type" = 'orcamento_expirado');