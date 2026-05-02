DROP INDEX "accounts_pluggy_account_id_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_pluggy_account_id_unique" ON "accounts" USING btree ("user_id","pluggy_account_id");