ALTER TABLE "users" ADD COLUMN "gender" text DEFAULT 'male';--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "activity_level" double precision DEFAULT 1.2;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "target_weight" double precision;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "target_date" text;