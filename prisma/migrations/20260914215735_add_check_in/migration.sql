-- CreateEnum
CREATE TYPE "CheckInResult" AS ENUM ('SUCCESS', 'DUPLICATE', 'INVALID', 'EXPIRED');

-- CreateEnum
CREATE TYPE "CheckInMethod" AS ENUM ('QR', 'MANUAL');

-- AlterTable
ALTER TABLE "submissions" ADD COLUMN     "checked_in_at" TIMESTAMPTZ(3),
ADD COLUMN     "checked_in_station_id" UUID,
ADD COLUMN     "ticket_issued_at" TIMESTAMPTZ(3),
ADD COLUMN     "ticket_nonce" TEXT;

-- CreateTable
CREATE TABLE "scan_stations" (
    "id" UUID NOT NULL,
    "form_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "login_token" TEXT NOT NULL,
    "pin_hash" TEXT NOT NULL,
    "failed_pin_count" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ(3),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_seen_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "scan_stations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "station_sessions" (
    "id_hash" TEXT NOT NULL,
    "station_id" UUID NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ(3),

    CONSTRAINT "station_sessions_pkey" PRIMARY KEY ("id_hash")
);

-- CreateTable
CREATE TABLE "check_in_attempts" (
    "id" UUID NOT NULL,
    "form_id" UUID NOT NULL,
    "station_id" UUID NOT NULL,
    "submission_id" UUID,
    "method" "CheckInMethod" NOT NULL,
    "result" "CheckInResult" NOT NULL,
    "reason" TEXT,
    "code_hash" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "check_in_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "scan_stations_login_token_key" ON "scan_stations"("login_token");

-- CreateIndex
CREATE INDEX "scan_stations_form_id_idx" ON "scan_stations"("form_id");

-- CreateIndex
CREATE INDEX "station_sessions_station_id_idx" ON "station_sessions"("station_id");

-- CreateIndex
CREATE INDEX "check_in_attempts_form_id_created_at_idx" ON "check_in_attempts"("form_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "check_in_attempts_station_id_created_at_idx" ON "check_in_attempts"("station_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "check_in_attempts_submission_id_idx" ON "check_in_attempts"("submission_id");

-- CreateIndex
CREATE INDEX "submissions_form_id_checked_in_at_idx" ON "submissions"("form_id", "checked_in_at");

-- AddForeignKey
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_checked_in_station_id_fkey" FOREIGN KEY ("checked_in_station_id") REFERENCES "scan_stations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scan_stations" ADD CONSTRAINT "scan_stations_form_id_fkey" FOREIGN KEY ("form_id") REFERENCES "forms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "station_sessions" ADD CONSTRAINT "station_sessions_station_id_fkey" FOREIGN KEY ("station_id") REFERENCES "scan_stations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "check_in_attempts" ADD CONSTRAINT "check_in_attempts_form_id_fkey" FOREIGN KEY ("form_id") REFERENCES "forms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "check_in_attempts" ADD CONSTRAINT "check_in_attempts_station_id_fkey" FOREIGN KEY ("station_id") REFERENCES "scan_stations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "check_in_attempts" ADD CONSTRAINT "check_in_attempts_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "submissions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
