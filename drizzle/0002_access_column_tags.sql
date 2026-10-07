CREATE TYPE "public"."access_status" AS ENUM('pending', 'approved', 'denied');--> statement-breakpoint
CREATE TABLE "app_access" (
	"email" text PRIMARY KEY NOT NULL,
	"status" "access_status" NOT NULL,
	"name" text,
	"image" text,
	"requested_at" timestamp with time zone,
	"decided_at" timestamp with time zone,
	"decided_by_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "board_column_tags" (
	"column_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	CONSTRAINT "board_column_tags_column_id_tag_id_pk" PRIMARY KEY("column_id","tag_id")
);
--> statement-breakpoint
ALTER TABLE "app_access" ADD CONSTRAINT "app_access_decided_by_id_user_id_fk" FOREIGN KEY ("decided_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_column_tags" ADD CONSTRAINT "board_column_tags_column_id_board_columns_id_fk" FOREIGN KEY ("column_id") REFERENCES "public"."board_columns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_column_tags" ADD CONSTRAINT "board_column_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "app_access_status_idx" ON "app_access" USING btree ("status");--> statement-breakpoint
CREATE INDEX "board_column_tags_tag_idx" ON "board_column_tags" USING btree ("tag_id");--> statement-breakpoint
-- Quienes ya usaban la app conservan el acceso.
INSERT INTO "app_access" ("email", "status", "name", "image", "decided_at")
SELECT lower("email"), 'approved', "name", "image", now() FROM "user"
ON CONFLICT ("email") DO NOTHING;
