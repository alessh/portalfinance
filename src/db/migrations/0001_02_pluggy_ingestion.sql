CREATE TYPE "public"."account_status" AS ENUM('ACTIVE', 'FROZEN', 'DELETED');--> statement-breakpoint
CREATE TYPE "public"."account_type" AS ENUM('CHECKING', 'SAVINGS', 'CREDIT_CARD', 'LOAN', 'INVESTMENT', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."item_status" AS ENUM('UPDATING', 'LOGIN_ERROR', 'OUTDATED', 'WAITING_USER_INPUT', 'UPDATED');--> statement-breakpoint
CREATE TYPE "public"."tx_status" AS ENUM('PENDING', 'POSTED');--> statement-breakpoint
CREATE TYPE "public"."tx_type" AS ENUM('DEBIT', 'CREDIT');--> statement-breakpoint
CREATE TABLE "pluggy_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"pluggy_item_id_enc" "bytea" NOT NULL,
	"pluggy_item_id_hash" "bytea" NOT NULL,
	"connector_id" text NOT NULL,
	"institution_name" text NOT NULL,
	"institution_logo_url" text,
	"status" "item_status" NOT NULL,
	"execution_status" text,
	"last_synced_at" timestamp with time zone,
	"last_error_at" timestamp with time zone,
	"last_reauth_email_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"pluggy_item_id" uuid NOT NULL,
	"pluggy_account_id" text NOT NULL,
	"type" "account_type" NOT NULL,
	"subtype" text,
	"name" text NOT NULL,
	"currency" text NOT NULL,
	"balance" numeric(15, 2) NOT NULL,
	"credit_limit" numeric(15, 2),
	"status" "account_status" DEFAULT 'ACTIVE' NOT NULL,
	"owner" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"pluggy_transaction_id" text NOT NULL,
	"type" "tx_type" NOT NULL,
	"amount" numeric(15, 2) NOT NULL,
	"currency" text NOT NULL,
	"description" text NOT NULL,
	"description_raw" text,
	"merchant_name" text,
	"merchant_cnpj" text,
	"posted_at" timestamp with time zone NOT NULL,
	"status" "tx_status" NOT NULL,
	"category_id" text,
	"is_transfer" boolean DEFAULT false NOT NULL,
	"is_credit_card_payment" boolean DEFAULT false NOT NULL,
	"transfer_pair_id" uuid,
	"pluggy_category" text,
	"payment_method" text,
	"raw_payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "users_cpf_hash_unique";--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "cpf_hash" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "cpf_enc" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "pluggy_items" ADD CONSTRAINT "pluggy_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_pluggy_item_id_pluggy_items_id_fk" FOREIGN KEY ("pluggy_item_id") REFERENCES "public"."pluggy_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_transfer_pair_id_transactions_id_fk" FOREIGN KEY ("transfer_pair_id") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pluggy_items_user_item_hash_unique" ON "pluggy_items" USING btree ("user_id","pluggy_item_id_hash");--> statement-breakpoint
CREATE INDEX "pluggy_items_user_status_idx" ON "pluggy_items" USING btree ("user_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_pluggy_account_id_unique" ON "accounts" USING btree ("pluggy_account_id");--> statement-breakpoint
CREATE INDEX "accounts_user_status_idx" ON "accounts" USING btree ("user_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "transactions_pluggy_tx_unique" ON "transactions" USING btree ("pluggy_transaction_id");--> statement-breakpoint
CREATE INDEX "transactions_user_posted_idx" ON "transactions" USING btree ("user_id","posted_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "transactions_account_posted_idx" ON "transactions" USING btree ("account_id","posted_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "transactions_user_posted_real_idx" ON "transactions" USING btree ("user_id","posted_at" DESC NULLS LAST) WHERE "transactions"."is_transfer" = false AND "transactions"."is_credit_card_payment" = false;--> statement-breakpoint
CREATE UNIQUE INDEX "users_cpf_hash_unique" ON "users" USING btree ("cpf_hash");