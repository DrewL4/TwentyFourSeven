-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_channel" (
    "_id" TEXT NOT NULL PRIMARY KEY,
    "number" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "icon" TEXT,
    "stealth" BOOLEAN NOT NULL DEFAULT false,
    "groupTitle" TEXT,
    "startTime" TEXT,
    "iconWidth" INTEGER NOT NULL DEFAULT 120,
    "iconDuration" INTEGER NOT NULL DEFAULT 60,
    "iconPosition" TEXT NOT NULL DEFAULT '2',
    "guideFlexPlaceholder" TEXT NOT NULL DEFAULT '',
    "guideMinimumDurationSeconds" INTEGER NOT NULL DEFAULT 300,
    "isOnDemand" BOOLEAN NOT NULL DEFAULT false,
    "onDemandModulo" INTEGER NOT NULL DEFAULT 1,
    "episodeMemoryEnabled" BOOLEAN NOT NULL DEFAULT false,
    "autoFilterEnabled" BOOLEAN NOT NULL DEFAULT false,
    "filterGenres" TEXT,
    "filterActors" TEXT,
    "filterDirectors" TEXT,
    "filterStudios" TEXT,
    "filterYearStart" INTEGER,
    "filterYearEnd" INTEGER,
    "filterRating" TEXT,
    "filterType" TEXT NOT NULL DEFAULT 'both',
    "lastAutoScanAt" DATETIME,
    "defaultEpisodeOrder" TEXT NOT NULL DEFAULT 'sequential',
    "respectEpisodeOrder" BOOLEAN NOT NULL DEFAULT true,
    "blockShuffle" BOOLEAN NOT NULL DEFAULT false,
    "blockShuffleSize" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_channel" ("_id", "autoFilterEnabled", "createdAt", "episodeMemoryEnabled", "filterActors", "filterDirectors", "filterGenres", "filterRating", "filterStudios", "filterType", "filterYearEnd", "filterYearStart", "groupTitle", "guideFlexPlaceholder", "guideMinimumDurationSeconds", "icon", "iconDuration", "iconPosition", "iconWidth", "isOnDemand", "lastAutoScanAt", "name", "number", "onDemandModulo", "startTime", "stealth", "updatedAt") SELECT "_id", "autoFilterEnabled", "createdAt", "episodeMemoryEnabled", "filterActors", "filterDirectors", "filterGenres", "filterRating", "filterStudios", "filterType", "filterYearEnd", "filterYearStart", "groupTitle", "guideFlexPlaceholder", "guideMinimumDurationSeconds", "icon", "iconDuration", "iconPosition", "iconWidth", "isOnDemand", "lastAutoScanAt", "name", "number", "onDemandModulo", "startTime", "stealth", "updatedAt" FROM "channel";
DROP TABLE "channel";
ALTER TABLE "new_channel" RENAME TO "channel";
CREATE UNIQUE INDEX "channel_number_key" ON "channel"("number");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
