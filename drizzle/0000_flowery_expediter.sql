CREATE TABLE "logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"food_name" text NOT NULL,
	"calories" integer NOT NULL,
	"protein" integer,
	"carbs" integer,
	"fat" integer,
	"image_url" text,
	"sheet_id" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "oauth_tokens" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"access_token" text,
	"refresh_token" text,
	"expiry_date" timestamp
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"google_id" text,
	"email" text,
	"name" text,
	"avatar" text,
	"age" integer DEFAULT 30,
	"weight" double precision DEFAULT 70,
	"height" double precision DEFAULT 170,
	"daily_goal" integer DEFAULT 2000,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "users_google_id_unique" UNIQUE("google_id")
);
--> statement-breakpoint
ALTER TABLE "logs" ADD CONSTRAINT "logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_tokens" ADD CONSTRAINT "oauth_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;