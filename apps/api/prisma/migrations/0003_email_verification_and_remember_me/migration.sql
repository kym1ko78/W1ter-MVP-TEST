ALTER TABLE "users"
ADD COLUMN "email_verified_at" TIMESTAMP(3),
ADD COLUMN "email_verification_token_hash" TEXT,
ADD COLUMN "email_verification_expires_at" TIMESTAMP(3),
ADD COLUMN "email_verification_sent_at" TIMESTAMP(3);

ALTER TABLE "refresh_tokens"
ADD COLUMN "is_persistent" BOOLEAN NOT NULL DEFAULT true;

CREATE UNIQUE INDEX "users_email_verification_token_hash_key"
ON "users"("email_verification_token_hash");
