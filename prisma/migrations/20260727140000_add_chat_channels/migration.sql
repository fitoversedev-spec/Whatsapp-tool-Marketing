-- Team channel + direct messages: a kind discriminator + a uniqueness key for
-- non-record threads. Additive; existing threads default to kind 'record'.
ALTER TABLE "chat_threads" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'record';
ALTER TABLE "chat_threads" ADD COLUMN "channel_key" TEXT;
CREATE UNIQUE INDEX "chat_threads_channel_key_key" ON "chat_threads"("channel_key");
