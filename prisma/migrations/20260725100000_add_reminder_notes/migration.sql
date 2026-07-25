-- Free-text context entered when scheduling a task/meeting/call reminder.
-- Additive, nullable — existing rows and reminder-create callers are unaffected.
ALTER TABLE "reminders" ADD COLUMN IF NOT EXISTS "notes" TEXT;
