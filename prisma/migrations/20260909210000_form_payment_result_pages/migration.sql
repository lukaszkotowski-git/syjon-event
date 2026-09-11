-- Treści strony powrotu z płatności, konfigurowane per formularz.
-- NULL = aplikacja pokazuje tekst domyślny.
ALTER TABLE "forms" ADD COLUMN "payment_success_title" TEXT;
ALTER TABLE "forms" ADD COLUMN "payment_success_body" TEXT;
ALTER TABLE "forms" ADD COLUMN "payment_error_title" TEXT;
ALTER TABLE "forms" ADD COLUMN "payment_error_body" TEXT;
