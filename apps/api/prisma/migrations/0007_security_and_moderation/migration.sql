CREATE TYPE "ModerationReportStatus" AS ENUM ('OPEN', 'ACTION_TAKEN', 'DISMISSED');

CREATE TABLE "user_blocks" (
  "blocker_id" UUID NOT NULL,
  "blocked_id" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "user_blocks_pkey" PRIMARY KEY ("blocker_id", "blocked_id")
);

CREATE TABLE "user_chat_preferences" (
  "user_id" UUID NOT NULL,
  "chat_id" UUID NOT NULL,
  "is_muted" BOOLEAN NOT NULL DEFAULT false,
  "muted_until" TIMESTAMP(3),
  "is_archived" BOOLEAN NOT NULL DEFAULT false,
  "archived_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "user_chat_preferences_pkey" PRIMARY KEY ("user_id", "chat_id")
);

CREATE TABLE "moderation_reports" (
  "id" UUID NOT NULL,
  "reporter_id" UUID NOT NULL,
  "reported_user_id" UUID,
  "chat_id" UUID,
  "message_id" UUID,
  "reason" TEXT NOT NULL,
  "details" TEXT,
  "status" "ModerationReportStatus" NOT NULL DEFAULT 'OPEN',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "resolved_at" TIMESTAMP(3),

  CONSTRAINT "moderation_reports_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "user_blocks_blocked_id_idx" ON "user_blocks"("blocked_id");
CREATE INDEX "user_chat_preferences_chat_id_idx" ON "user_chat_preferences"("chat_id");
CREATE INDEX "user_chat_preferences_user_id_is_archived_idx" ON "user_chat_preferences"("user_id", "is_archived");
CREATE INDEX "moderation_reports_reporter_id_created_at_idx" ON "moderation_reports"("reporter_id", "created_at");
CREATE INDEX "moderation_reports_reported_user_id_created_at_idx" ON "moderation_reports"("reported_user_id", "created_at");
CREATE INDEX "moderation_reports_chat_id_created_at_idx" ON "moderation_reports"("chat_id", "created_at");
CREATE INDEX "moderation_reports_message_id_created_at_idx" ON "moderation_reports"("message_id", "created_at");

ALTER TABLE "user_blocks"
  ADD CONSTRAINT "user_blocks_blocker_id_fkey"
  FOREIGN KEY ("blocker_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "user_blocks"
  ADD CONSTRAINT "user_blocks_blocked_id_fkey"
  FOREIGN KEY ("blocked_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "user_chat_preferences"
  ADD CONSTRAINT "user_chat_preferences_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "user_chat_preferences"
  ADD CONSTRAINT "user_chat_preferences_chat_id_fkey"
  FOREIGN KEY ("chat_id") REFERENCES "chats"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "moderation_reports"
  ADD CONSTRAINT "moderation_reports_reporter_id_fkey"
  FOREIGN KEY ("reporter_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "moderation_reports"
  ADD CONSTRAINT "moderation_reports_reported_user_id_fkey"
  FOREIGN KEY ("reported_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "moderation_reports"
  ADD CONSTRAINT "moderation_reports_chat_id_fkey"
  FOREIGN KEY ("chat_id") REFERENCES "chats"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "moderation_reports"
  ADD CONSTRAINT "moderation_reports_message_id_fkey"
  FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
