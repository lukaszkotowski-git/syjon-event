-- AlterEnum
ALTER TYPE "AdminRole" ADD VALUE 'SUPER_ADMIN' BEFORE 'ADMIN';

-- AlterTable
ALTER TABLE "admins" ADD COLUMN     "env_password_digest" TEXT;
