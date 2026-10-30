CREATE TABLE "attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"work_order_id" uuid NOT NULL,
	"storage_key" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"sha256" text NOT NULL,
	"uploaded_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	CONSTRAINT "attachments_storage_key_unique" UNIQUE("storage_key"),
	CONSTRAINT "attachments_type_ck" CHECK ("attachments"."content_type" in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf'))
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"phone" text NOT NULL,
	"email" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customers_tenant_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"category" text NOT NULL,
	"brand" text NOT NULL,
	"model" text NOT NULL,
	"color" text,
	"serial_number" text,
	"imei" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "devices_tenant_customer_id_key" UNIQUE("tenant_id","customer_id","id"),
	CONSTRAINT "devices_category_ck" CHECK ("devices"."category" in ('celular', 'tablet', 'notebook', 'computador', 'console', 'outro')),
	CONSTRAINT "devices_imei_ck" CHECK ("devices"."imei" is null or "devices"."imei" ~ '^[0-9]{15}$')
);
--> statement-breakpoint
CREATE TABLE "intake_inspections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"work_order_id" uuid NOT NULL,
	"physical_condition" text NOT NULL,
	"accessories" jsonb NOT NULL,
	"checklist" jsonb NOT NULL,
	"password_informed" boolean DEFAULT false NOT NULL,
	"received_by" uuid NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "intake_tenant_work_order_key" UNIQUE("tenant_id","work_order_id")
);
--> statement-breakpoint
CREATE TABLE "protocol_counters" (
	"tenant_id" uuid NOT NULL,
	"year" integer NOT NULL,
	"last_number" integer NOT NULL,
	CONSTRAINT "protocol_counters_tenant_id_year_pk" PRIMARY KEY("tenant_id","year")
);
--> statement-breakpoint
CREATE TABLE "work_order_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"work_order_id" uuid NOT NULL,
	"type" text NOT NULL,
	"from_state" text,
	"to_state" text,
	"actor_user_id" uuid NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"protocol" text NOT NULL,
	"customer_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"reported_defect" text NOT NULL,
	"state" text DEFAULT 'RECEBIDA' NOT NULL,
	"priority" text DEFAULT 'normal' NOT NULL,
	"technician_id" uuid,
	"opened_by" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"idempotency_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_orders_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "work_orders_tenant_protocol_key" UNIQUE("tenant_id","protocol"),
	CONSTRAINT "work_orders_tenant_idempotency_key" UNIQUE("tenant_id","idempotency_key"),
	CONSTRAINT "work_orders_state_ck" CHECK ("work_orders"."state" in ('RECEBIDA', 'EM_DIAGNOSTICO', 'AGUARDANDO_APROVACAO', 'AGUARDANDO_PECA', 'EM_REPARO', 'EM_TESTE', 'PRONTA_RETIRADA', 'PRONTA_RETIRADA_SEM_REPARO', 'ENTREGUE', 'ENCERRADA', 'CANCELADA')),
	CONSTRAINT "work_orders_priority_ck" CHECK ("work_orders"."priority" in ('baixa', 'normal', 'alta', 'urgente'))
);
--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_work_order_fk" FOREIGN KEY ("tenant_id","work_order_id") REFERENCES "public"."work_orders"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_customer_fk" FOREIGN KEY ("tenant_id","customer_id") REFERENCES "public"."customers"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intake_inspections" ADD CONSTRAINT "intake_inspections_received_by_users_id_fk" FOREIGN KEY ("received_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intake_inspections" ADD CONSTRAINT "intake_work_order_fk" FOREIGN KEY ("tenant_id","work_order_id") REFERENCES "public"."work_orders"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "protocol_counters" ADD CONSTRAINT "protocol_counters_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_events" ADD CONSTRAINT "work_order_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_events" ADD CONSTRAINT "events_work_order_fk" FOREIGN KEY ("tenant_id","work_order_id") REFERENCES "public"."work_orders"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_opened_by_users_id_fk" FOREIGN KEY ("opened_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_device_fk" FOREIGN KEY ("tenant_id","customer_id","device_id") REFERENCES "public"."devices"("tenant_id","customer_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_technician_fk" FOREIGN KEY ("tenant_id","technician_id") REFERENCES "public"."memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attachments_work_order_idx" ON "attachments" USING btree ("tenant_id","work_order_id");--> statement-breakpoint
CREATE INDEX "customers_tenant_phone_idx" ON "customers" USING btree ("tenant_id","phone");--> statement-breakpoint
CREATE INDEX "customers_tenant_created_idx" ON "customers" USING btree ("tenant_id","created_at","id");--> statement-breakpoint
CREATE INDEX "devices_tenant_customer_idx" ON "devices" USING btree ("tenant_id","customer_id");--> statement-breakpoint
CREATE INDEX "events_work_order_idx" ON "work_order_events" USING btree ("tenant_id","work_order_id","created_at");--> statement-breakpoint
CREATE INDEX "work_orders_tenant_state_idx" ON "work_orders" USING btree ("tenant_id","state","created_at","id");--> statement-breakpoint
CREATE INDEX "work_orders_tenant_technician_idx" ON "work_orders" USING btree ("tenant_id","technician_id");