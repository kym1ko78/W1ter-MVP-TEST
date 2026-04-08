ALTER TABLE "messages"
ALTER COLUMN "body" DROP NOT NULL;

CREATE TABLE "attachments" (
  "id" TEXT NOT NULL,
  "message_id" TEXT NOT NULL,
  "uploader_id" TEXT NOT NULL,
  "storage_key" TEXT NOT NULL,
  "original_name" TEXT NOT NULL,
  "mime_type" TEXT NOT NULL,
  "size_bytes" INTEGER NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "attachments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "attachments_storage_key_key" ON "attachments"("storage_key");
CREATE INDEX "attachments_message_id_idx" ON "attachments"("message_id");
CREATE INDEX "attachments_uploader_id_idx" ON "attachments"("uploader_id");

ALTER TABLE "attachments"
ADD CONSTRAINT "attachments_message_id_fkey"
FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "attachments"
ADD CONSTRAINT "attachments_uploader_id_fkey"
FOREIGN KEY ("uploader_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;