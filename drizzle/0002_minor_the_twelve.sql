CREATE TABLE "google_credentials" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"google_email" text,
	"calendar_id" text DEFAULT 'primary' NOT NULL,
	"refresh_token_cipher" text NOT NULL,
	"refresh_token_iv" text NOT NULL,
	"refresh_token_tag" text NOT NULL,
	"status" text DEFAULT 'connected' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "google_credentials" ADD CONSTRAINT "google_credentials_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "google_credentials_org_uq" ON "google_credentials" USING btree ("organization_id");