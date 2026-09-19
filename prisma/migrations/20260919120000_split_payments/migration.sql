-- AlterEnum
ALTER TYPE "SubmissionStatus" ADD VALUE 'DEPOSIT_PAID';

-- CreateEnum
CREATE TYPE "PaymentKind" AS ENUM ('FULL', 'DEPOSIT', 'BALANCE');

-- AlterTable
ALTER TABLE "forms" ADD COLUMN     "balance_due_at" TIMESTAMPTZ(3),
ADD COLUMN     "deposit_email_body" TEXT,
ADD COLUMN     "deposit_email_title" TEXT;

-- AlterTable
ALTER TABLE "ticket_types" ADD COLUMN     "deposit_cents" INTEGER;

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "kind" "PaymentKind" NOT NULL DEFAULT 'FULL';

-- AlterTable
ALTER TABLE "submissions" ADD COLUMN     "deposit_cents" INTEGER,
ADD COLUMN     "deposit_email_sent_at" TIMESTAMPTZ(3),
ADD COLUMN     "email_token_hash" TEXT,
ADD COLUMN     "paid_cents" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE UNIQUE INDEX "submissions_email_token_hash_key" ON "submissions"("email_token_hash");

-- Dotychczasowe opłacone zgłoszenia były opłacane w całości.
UPDATE "submissions" SET "paid_cents" = "ticket_price_cents" WHERE "status" = 'PAID';
