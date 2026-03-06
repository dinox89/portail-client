CREATE EXTENSION IF NOT EXISTS "pgcrypto";
ALTER TABLE "ClientPortal" ADD COLUMN "accessToken" UUID NOT NULL DEFAULT gen_random_uuid();
CREATE UNIQUE INDEX "ClientPortal_accessToken_key" ON "ClientPortal"("accessToken");
