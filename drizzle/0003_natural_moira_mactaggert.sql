ALTER TABLE "contact" ALTER COLUMN "phone" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "contact" ADD COLUMN "channel" text DEFAULT 'whatsapp' NOT NULL;--> statement-breakpoint
ALTER TABLE "contact" ADD COLUMN "external_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "contact_org_channel_external_uq" ON "contact" USING btree ("organization_id","channel","external_id");