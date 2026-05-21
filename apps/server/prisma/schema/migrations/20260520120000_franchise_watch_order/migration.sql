-- AlterTable
ALTER TABLE "media_movie" ADD COLUMN "tmdbId" INTEGER;
ALTER TABLE "media_movie" ADD COLUMN "imdbId" TEXT;

-- CreateIndex
CREATE INDEX "media_movie_tmdbId_idx" ON "media_movie"("tmdbId");

-- AlterTable
ALTER TABLE "settings" ADD COLUMN "tmdbApiKey" TEXT NOT NULL DEFAULT '';

-- CreateTable
CREATE TABLE "franchise" (
    "_id" TEXT NOT NULL PRIMARY KEY,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "source" TEXT NOT NULL DEFAULT 'CUSTOM',
    "sortMode" TEXT NOT NULL DEFAULT 'CHRONOLOGICAL',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "franchise_entry" (
    "_id" TEXT NOT NULL PRIMARY KEY,
    "franchiseId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "label" TEXT,
    "movieId" TEXT,
    "tmdbId" INTEGER,
    "titlePattern" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "franchise_entry_franchiseId_fkey" FOREIGN KEY ("franchiseId") REFERENCES "franchise" ("_id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "franchise_entry_movieId_fkey" FOREIGN KEY ("movieId") REFERENCES "media_movie" ("_id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "franchise_slug_key" ON "franchise"("slug");

-- CreateIndex
CREATE INDEX "franchise_entry_franchiseId_position_idx" ON "franchise_entry"("franchiseId", "position");
