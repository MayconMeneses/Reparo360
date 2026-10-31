CREATE TABLE "customer_verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"grant_id" uuid NOT NULL,
	"quote_version_id" uuid NOT NULL,
	"code_hash" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "verifications_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "verifications_attempts_ck" CHECK ("customer_verifications"."attempts" >= 0)
);
--> statement-breakpoint
ALTER TABLE "work_order_events" DROP CONSTRAINT "events_actor_ck";--> statement-breakpoint
ALTER TABLE "quote_decisions" ALTER COLUMN "decided_by" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "work_order_events" ADD COLUMN "origin" text DEFAULT 'equipe' NOT NULL;--> statement-breakpoint
ALTER TABLE "quote_decisions" ADD COLUMN "verification_id" uuid;--> statement-breakpoint
ALTER TABLE "customer_access_grants" ADD CONSTRAINT "grants_tenant_id_unique" UNIQUE("tenant_id","id");--> statement-breakpoint
ALTER TABLE "customer_verifications" ADD CONSTRAINT "verifications_grant_fk" FOREIGN KEY ("tenant_id","grant_id") REFERENCES "public"."customer_access_grants"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_verifications" ADD CONSTRAINT "verifications_quote_fk" FOREIGN KEY ("tenant_id","quote_version_id") REFERENCES "public"."quote_versions"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "verifications_grant_idx" ON "customer_verifications" USING btree ("tenant_id","grant_id","created_at");--> statement-breakpoint
ALTER TABLE "work_order_events" ADD CONSTRAINT "events_origin_ck" CHECK ("work_order_events"."origin" in ('equipe', 'sistema', 'cliente') and ("work_order_events"."origin" <> 'cliente' or ("work_order_events"."actor_user_id" is null and "work_order_events"."type" in ('orcamento_aprovado', 'orcamento_recusado'))));--> statement-breakpoint
ALTER TABLE "work_order_events" ADD CONSTRAINT "events_actor_ck" CHECK ("work_order_events"."actor_user_id" is not null or "work_order_events"."type" = 'orcamento_expirado' or ("work_order_events"."origin" = 'cliente' and "work_order_events"."type" in ('orcamento_aprovado', 'orcamento_recusado')));--> statement-breakpoint
ALTER TABLE "quote_decisions" ADD CONSTRAINT "quote_decisions_who_ck" CHECK (("quote_decisions"."channel" = 'presencial' and "quote_decisions"."decided_by" is not null and "quote_decisions"."verification_id" is null) or ("quote_decisions"."channel" = 'remoto' and "quote_decisions"."decided_by" is null and "quote_decisions"."verification_id" is not null));--> statement-breakpoint
ALTER TABLE "quote_decisions" ADD CONSTRAINT "quote_decisions_verification_fk" FOREIGN KEY ("tenant_id","verification_id") REFERENCES "public"."customer_verifications"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

-- RLS e grants dos códigos do consumidor. O servidor primeiro lê o link (por hash), depois passa a
-- usar o contexto da empresa do link; por isso a política é a mesma das demais tabelas da empresa.
ALTER TABLE customer_verifications ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE customer_verifications FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY verifications_isolation ON customer_verifications FOR ALL
  USING (tenant_id = app_tenant_id())
  WITH CHECK (tenant_id = app_tenant_id());
--> statement-breakpoint
GRANT SELECT, INSERT ON customer_verifications TO reparo_app;
--> statement-breakpoint
-- Só tentativas e consumo mudam; o código (hash), a versão e a validade ficam imutáveis.
GRANT UPDATE (attempts, consumed_at) ON customer_verifications TO reparo_app;
