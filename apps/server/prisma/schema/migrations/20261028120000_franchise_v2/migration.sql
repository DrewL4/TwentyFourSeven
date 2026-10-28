-- AlterTable
ALTER TABLE "franchise" ADD COLUMN "ownerId" TEXT;
ALTER TABLE "franchise" ADD COLUMN "includeShows" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "franchise" ADD COLUMN "tmdbKeywordId" INTEGER;
ALTER TABLE "franchise" ADD COLUMN "storyListKey" TEXT;
ALTER TABLE "franchise" ADD COLUMN "customOrder" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "franchise_entry" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'MOVIE';
ALTER TABLE "franchise_entry" ADD COLUMN "entryKey" TEXT;
ALTER TABLE "franchise_entry" ADD COLUMN "showId" TEXT REFERENCES "media_show"("_id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "franchise_entry" ADD COLUMN "seasonNumber" INTEGER;
ALTER TABLE "franchise_entry" ADD COLUMN "episodeStart" INTEGER;
ALTER TABLE "franchise_entry" ADD COLUMN "episodeEnd" INTEGER;
ALTER TABLE "franchise_entry" ADD COLUMN "releaseDate" DATETIME;
ALTER TABLE "franchise_entry" ADD COLUMN "posterPath" TEXT;
ALTER TABLE "franchise_entry" ADD COLUMN "storyIndex" INTEGER;
ALTER TABLE "franchise_entry" ADD COLUMN "manual" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "franchise_entry" ADD COLUMN "excluded" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "franchise_entry" ADD COLUMN "requestedAt" DATETIME;
ALTER TABLE "franchise_entry" ADD COLUMN "wtRequestId" INTEGER;

-- Rows saved before this change are movies with a TMDB id: give them the stable key a sync merges on.
UPDATE "franchise_entry" SET "entryKey" = 'movie:' || "tmdbId" WHERE "tmdbId" IS NOT NULL;

-- CreateIndex
CREATE INDEX "franchise_entry_franchiseId_entryKey_idx" ON "franchise_entry"("franchiseId", "entryKey");

-- AlterTable
ALTER TABLE "user" ADD COLUMN "watchTowerToken" TEXT;
