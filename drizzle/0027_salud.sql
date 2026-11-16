CREATE TABLE "appointment_type" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"duration_minutes" integer NOT NULL,
	"price" integer,
	"prep_notes" text,
	"deposit_amount" integer,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "health_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"reminder_lead_hours" jsonb NOT NULL,
	"reminder_template_id" text,
	"waitlist_enabled" boolean DEFAULT true NOT NULL,
	"deposit_payment_info" text,
	"survey_enabled" boolean DEFAULT true NOT NULL,
	"survey_delay_hours" integer DEFAULT 3 NOT NULL,
	"review_url" text,
	"reactivation_enabled" boolean DEFAULT false NOT NULL,
	"reactivation_months" integer DEFAULT 6 NOT NULL,
	"reactivation_template_id" text,
	"survey_template_id" text,
	"urgency_message" text,
	"urgency_keywords" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "insurance" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "patient_profile" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"document_number" text,
	"birth_date" text,
	"insurance_id" text,
	"affiliate_number" text,
	"admin_notes" text,
	"reactivation_sent_at" timestamp,
	"opt_out_followups" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "professional" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"specialty" text,
	"color" text,
	"active" boolean DEFAULT true NOT NULL,
	"weekly_hours" jsonb,
	"slot_minutes" integer,
	"buffer_minutes" integer,
	"meeting_link" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "professional_appointment_type" (
	"organization_id" text NOT NULL,
	"professional_id" text NOT NULL,
	"appointment_type_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "professional_insurance" (
	"organization_id" text NOT NULL,
	"professional_id" text NOT NULL,
	"insurance_id" text NOT NULL,
	"copay" text
);
--> statement-breakpoint
CREATE TABLE "triage_event" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"contact_id" text,
	"conversation_id" text,
	"level" text NOT NULL,
	"reason" text NOT NULL,
	"resolved_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "waitlist_entry" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"conversation_id" text,
	"professional_id" text,
	"appointment_type_id" text,
	"preferences" text,
	"status" text DEFAULT 'waiting' NOT NULL,
	"offered_start_utc" timestamp,
	"offered_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "booking_org_active_slot_uq";--> statement-breakpoint
ALTER TABLE "booking" ADD COLUMN "professional_id" text;--> statement-breakpoint
ALTER TABLE "booking" ADD COLUMN "appointment_type_id" text;--> statement-breakpoint
ALTER TABLE "booking" ADD COLUMN "insurance_id" text;--> statement-breakpoint
ALTER TABLE "booking" ADD COLUMN "confirmation" text DEFAULT 'pendiente' NOT NULL;--> statement-breakpoint
ALTER TABLE "booking" ADD COLUMN "confirmed_at" timestamp;--> statement-breakpoint
ALTER TABLE "booking" ADD COLUMN "reminder_first_at" timestamp;--> statement-breakpoint
ALTER TABLE "booking" ADD COLUMN "reminder_second_at" timestamp;--> statement-breakpoint
ALTER TABLE "booking" ADD COLUMN "deposit_amount" integer;--> statement-breakpoint
ALTER TABLE "booking" ADD COLUMN "deposit_status" text DEFAULT 'no_aplica' NOT NULL;--> statement-breakpoint
ALTER TABLE "booking" ADD COLUMN "survey_sent_at" timestamp;--> statement-breakpoint
ALTER TABLE "booking" ADD COLUMN "survey_score" integer;--> statement-breakpoint
ALTER TABLE "booking" ADD COLUMN "survey_comment" text;--> statement-breakpoint
ALTER TABLE "offered_slot" ADD COLUMN "professional_id" text;--> statement-breakpoint
ALTER TABLE "offered_slot" ADD COLUMN "appointment_type_id" text;--> statement-breakpoint
ALTER TABLE "appointment_type" ADD CONSTRAINT "appointment_type_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "health_settings" ADD CONSTRAINT "health_settings_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insurance" ADD CONSTRAINT "insurance_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_profile" ADD CONSTRAINT "patient_profile_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_profile" ADD CONSTRAINT "patient_profile_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_profile" ADD CONSTRAINT "patient_profile_insurance_id_insurance_id_fk" FOREIGN KEY ("insurance_id") REFERENCES "public"."insurance"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "professional" ADD CONSTRAINT "professional_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "professional_appointment_type" ADD CONSTRAINT "professional_appointment_type_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "professional_appointment_type" ADD CONSTRAINT "professional_appointment_type_professional_id_professional_id_fk" FOREIGN KEY ("professional_id") REFERENCES "public"."professional"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "professional_appointment_type" ADD CONSTRAINT "professional_appointment_type_appointment_type_id_appointment_type_id_fk" FOREIGN KEY ("appointment_type_id") REFERENCES "public"."appointment_type"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "professional_insurance" ADD CONSTRAINT "professional_insurance_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "professional_insurance" ADD CONSTRAINT "professional_insurance_professional_id_professional_id_fk" FOREIGN KEY ("professional_id") REFERENCES "public"."professional"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "professional_insurance" ADD CONSTRAINT "professional_insurance_insurance_id_insurance_id_fk" FOREIGN KEY ("insurance_id") REFERENCES "public"."insurance"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "triage_event" ADD CONSTRAINT "triage_event_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "triage_event" ADD CONSTRAINT "triage_event_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "triage_event" ADD CONSTRAINT "triage_event_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversation"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waitlist_entry" ADD CONSTRAINT "waitlist_entry_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waitlist_entry" ADD CONSTRAINT "waitlist_entry_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waitlist_entry" ADD CONSTRAINT "waitlist_entry_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversation"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waitlist_entry" ADD CONSTRAINT "waitlist_entry_professional_id_professional_id_fk" FOREIGN KEY ("professional_id") REFERENCES "public"."professional"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waitlist_entry" ADD CONSTRAINT "waitlist_entry_appointment_type_id_appointment_type_id_fk" FOREIGN KEY ("appointment_type_id") REFERENCES "public"."appointment_type"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "appointment_type_org_idx" ON "appointment_type" USING btree ("organization_id","active");--> statement-breakpoint
CREATE UNIQUE INDEX "health_settings_org_uq" ON "health_settings" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "insurance_org_name_uq" ON "insurance" USING btree ("organization_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "patient_profile_contact_uq" ON "patient_profile" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "professional_org_idx" ON "professional" USING btree ("organization_id","active");--> statement-breakpoint
CREATE UNIQUE INDEX "pro_apt_uq" ON "professional_appointment_type" USING btree ("professional_id","appointment_type_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pro_ins_uq" ON "professional_insurance" USING btree ("professional_id","insurance_id");--> statement-breakpoint
CREATE INDEX "triage_org_open_idx" ON "triage_event" USING btree ("organization_id","resolved_at");--> statement-breakpoint
CREATE INDEX "waitlist_org_status_idx" ON "waitlist_entry" USING btree ("organization_id","status");--> statement-breakpoint
ALTER TABLE "booking" ADD CONSTRAINT "booking_professional_id_professional_id_fk" FOREIGN KEY ("professional_id") REFERENCES "public"."professional"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking" ADD CONSTRAINT "booking_appointment_type_id_appointment_type_id_fk" FOREIGN KEY ("appointment_type_id") REFERENCES "public"."appointment_type"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking" ADD CONSTRAINT "booking_insurance_id_insurance_id_fk" FOREIGN KEY ("insurance_id") REFERENCES "public"."insurance"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offered_slot" ADD CONSTRAINT "offered_slot_professional_id_professional_id_fk" FOREIGN KEY ("professional_id") REFERENCES "public"."professional"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offered_slot" ADD CONSTRAINT "offered_slot_appointment_type_id_appointment_type_id_fk" FOREIGN KEY ("appointment_type_id") REFERENCES "public"."appointment_type"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "booking_org_professional_idx" ON "booking" USING btree ("organization_id","professional_id","scheduled_at");--> statement-breakpoint
CREATE UNIQUE INDEX "booking_org_active_slot_uq" ON "booking" USING btree ("organization_id",coalesce("professional_id", ''),"scheduled_at") WHERE "booking"."status" in ('agendada','realizada') and "booking"."is_test" = false;