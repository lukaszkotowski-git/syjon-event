-- AlterTable
ALTER TABLE "forms" ADD COLUMN "event_date" TIMESTAMPTZ(3);

-- Backfill: brak lepszego domyślnego terminu dla istniejących wydarzeń niż data zamknięcia
-- zapisów — admin poprawi ją ręcznie w edytorze wydarzenia.
UPDATE "forms" SET "event_date" = "closes_at" WHERE "event_date" IS NULL;

ALTER TABLE "forms" ALTER COLUMN "event_date" SET NOT NULL;
