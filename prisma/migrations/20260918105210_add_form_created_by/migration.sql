-- AlterTable
ALTER TABLE "forms" ADD COLUMN "created_by_admin_id" UUID;

-- AddForeignKey
ALTER TABLE "forms" ADD CONSTRAINT "forms_created_by_admin_id_fkey" FOREIGN KEY ("created_by_admin_id") REFERENCES "admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;
