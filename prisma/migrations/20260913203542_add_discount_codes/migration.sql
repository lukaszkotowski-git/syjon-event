-- CreateEnum
CREATE TYPE "DiscountType" AS ENUM ('PERCENT', 'AMOUNT');

-- AlterTable
ALTER TABLE "submissions" ADD COLUMN     "discount_amount_cents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "discount_code_id" UUID,
ADD COLUMN     "discount_code_snapshot" TEXT;

-- CreateTable
CREATE TABLE "discount_codes" (
    "id" UUID NOT NULL,
    "form_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "type" "DiscountType" NOT NULL,
    "value" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "discount_codes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "discount_codes_form_id_idx" ON "discount_codes"("form_id");

-- CreateIndex
CREATE UNIQUE INDEX "discount_codes_form_id_code_key" ON "discount_codes"("form_id", "code");

-- AddForeignKey
ALTER TABLE "discount_codes" ADD CONSTRAINT "discount_codes_form_id_fkey" FOREIGN KEY ("form_id") REFERENCES "forms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_discount_code_id_fkey" FOREIGN KEY ("discount_code_id") REFERENCES "discount_codes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
