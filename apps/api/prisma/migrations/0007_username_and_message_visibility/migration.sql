ALTER TABLE "users" ADD COLUMN "username" TEXT;

UPDATE "users"
SET "username" = CASE
  WHEN regexp_replace(lower("display_name"), '[^a-z0-9]+', '_', 'g') <> '' THEN
    left(trim(both '_' from regexp_replace(lower("display_name"), '[^a-z0-9]+', '_', 'g')), 18) || '_' || substring("id" from 1 for 6)
  ELSE
    'user_' || substring("id" from 1 for 8)
END;

UPDATE "users"
SET "username" = 'user_' || substring("id" from 1 for 8)
WHERE "username" IS NULL OR "username" = '' OR "username" = '_';

ALTER TABLE "users" ALTER COLUMN "username" SET NOT NULL;

CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

CREATE TABLE "message_hidden_for" (
    "message_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "hidden_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_hidden_for_pkey" PRIMARY KEY ("message_id","user_id")
);

CREATE INDEX "message_hidden_for_user_id_idx" ON "message_hidden_for"("user_id");

ALTER TABLE "message_hidden_for" ADD CONSTRAINT "message_hidden_for_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "message_hidden_for" ADD CONSTRAINT "message_hidden_for_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
