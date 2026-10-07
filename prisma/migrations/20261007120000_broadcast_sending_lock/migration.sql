-- Sliced broadcast sending: big broadcasts now go out in ~45 s server runs
-- that hand over to the next one. This nullable lock column makes sure only
-- one run sends a given broadcast at a time. Nothing existing is changed.

-- AlterTable
ALTER TABLE "broadcasts" ADD COLUMN "sending_until" TIMESTAMP(3);
