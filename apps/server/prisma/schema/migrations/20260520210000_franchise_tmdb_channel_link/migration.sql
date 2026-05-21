-- AlterTable
ALTER TABLE "franchise" ADD COLUMN "tmdbCollectionId" INTEGER;
ALTER TABLE "franchise" ADD COLUMN "timelineUrl" TEXT;
ALTER TABLE "franchise" ADD COLUMN "listingsUrl" TEXT;
ALTER TABLE "franchise" ADD COLUMN "lastSyncedAt" DATETIME;

-- AlterTable
ALTER TABLE "channel" ADD COLUMN "franchiseId" TEXT;

-- CreateIndex
CREATE INDEX "channel_franchiseId_idx" ON "channel"("franchiseId");
