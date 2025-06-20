-- AlterTable
ALTER TABLE "user" ADD COLUMN "watchTowerJoinDate" DATETIME;

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
    "autoSortMethod" TEXT,
    "franchiseAutomation" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_channel" ("_id", "autoFilterEnabled", "autoSortMethod", "blockShuffle", "blockShuffleSize", "createdAt", "defaultEpisodeOrder", "episodeMemoryEnabled", "filterActors", "filterDirectors", "filterGenres", "filterRating", "filterStudios", "filterType", "filterYearEnd", "filterYearStart", "groupTitle", "guideFlexPlaceholder", "guideMinimumDurationSeconds", "icon", "iconDuration", "iconPosition", "iconWidth", "isOnDemand", "lastAutoScanAt", "name", "number", "onDemandModulo", "respectEpisodeOrder", "startTime", "stealth", "updatedAt") SELECT "_id", "autoFilterEnabled", "autoSortMethod", "blockShuffle", "blockShuffleSize", "createdAt", "defaultEpisodeOrder", "episodeMemoryEnabled", "filterActors", "filterDirectors", "filterGenres", "filterRating", "filterStudios", "filterType", "filterYearEnd", "filterYearStart", "groupTitle", "guideFlexPlaceholder", "guideMinimumDurationSeconds", "icon", "iconDuration", "iconPosition", "iconWidth", "isOnDemand", "lastAutoScanAt", "name", "number", "onDemandModulo", "respectEpisodeOrder", "startTime", "stealth", "updatedAt" FROM "channel";
DROP TABLE "channel";
ALTER TABLE "new_channel" RENAME TO "channel";
CREATE UNIQUE INDEX "channel_number_key" ON "channel"("number");
CREATE TABLE "new_channel_show" (
    "_id" TEXT NOT NULL PRIMARY KEY,
    "channelId" TEXT NOT NULL,
    "showId" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "weight" INTEGER NOT NULL DEFAULT 1,
    "shuffle" BOOLEAN NOT NULL DEFAULT false,
    "shuffleOrder" TEXT NOT NULL DEFAULT 'next',
    "blockShuffle" BOOLEAN NOT NULL DEFAULT false,
    "blockShuffleSize" INTEGER NOT NULL DEFAULT 1,
    "lastPlayedEpisodeId" TEXT,
    "lastPlayedAt" DATETIME,
    "respectOrder" BOOLEAN NOT NULL DEFAULT true,
    "maxConsecutiveEpisodes" INTEGER NOT NULL DEFAULT 0,
    "autoAddNewEpisodes" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "channel_show_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "channel" ("_id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "channel_show_showId_fkey" FOREIGN KEY ("showId") REFERENCES "media_show" ("_id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_channel_show" ("_id", "blockShuffle", "blockShuffleSize", "channelId", "createdAt", "lastPlayedAt", "lastPlayedEpisodeId", "maxConsecutiveEpisodes", "order", "respectOrder", "showId", "shuffle", "shuffleOrder", "updatedAt", "weight") SELECT "_id", "blockShuffle", "blockShuffleSize", "channelId", "createdAt", "lastPlayedAt", "lastPlayedEpisodeId", "maxConsecutiveEpisodes", "order", "respectOrder", "showId", "shuffle", "shuffleOrder", "updatedAt", "weight" FROM "channel_show";
DROP TABLE "channel_show";
ALTER TABLE "new_channel_show" RENAME TO "channel_show";
CREATE UNIQUE INDEX "channel_show_channelId_showId_key" ON "channel_show"("channelId", "showId");
CREATE TABLE "new_plex_settings" (
    "_id" TEXT NOT NULL PRIMARY KEY DEFAULT 'singleton',
    "url" TEXT NOT NULL DEFAULT '',
    "token" TEXT NOT NULL DEFAULT '',
    "autoRefreshLibraries" BOOLEAN NOT NULL DEFAULT false,
    "refreshInterval" INTEGER NOT NULL DEFAULT 24,
    "arGuide" BOOLEAN NOT NULL DEFAULT false,
    "arChannels" BOOLEAN NOT NULL DEFAULT false,
    "webhookEnabled" BOOLEAN NOT NULL DEFAULT true,
    "connectionTimeout" INTEGER NOT NULL DEFAULT 10000,
    "requestTimeout" INTEGER NOT NULL DEFAULT 30000,
    "settingsId" TEXT NOT NULL DEFAULT 'singleton',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "plex_settings_settingsId_fkey" FOREIGN KEY ("settingsId") REFERENCES "settings" ("_id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_plex_settings" ("_id", "arChannels", "arGuide", "autoRefreshLibraries", "connectionTimeout", "createdAt", "refreshInterval", "requestTimeout", "settingsId", "token", "updatedAt", "url") SELECT "_id", "arChannels", "arGuide", "autoRefreshLibraries", "connectionTimeout", "createdAt", "refreshInterval", "requestTimeout", "settingsId", "token", "updatedAt", "url" FROM "plex_settings";
DROP TABLE "plex_settings";
ALTER TABLE "new_plex_settings" RENAME TO "plex_settings";
CREATE UNIQUE INDEX "plex_settings_settingsId_key" ON "plex_settings"("settingsId");
CREATE TABLE "new_settings" (
    "_id" TEXT NOT NULL PRIMARY KEY DEFAULT 'singleton',
    "port" INTEGER NOT NULL DEFAULT 3000,
    "ffmpegPath" TEXT NOT NULL DEFAULT 'ffmpeg',
    "concurrentStreams" INTEGER NOT NULL DEFAULT 1,
    "hdhrActive" BOOLEAN NOT NULL DEFAULT false,
    "hdhrDeviceId" TEXT NOT NULL DEFAULT '',
    "hdhrFriendlyName" TEXT NOT NULL DEFAULT 'My TV Server',
    "hdhrTunerCount" INTEGER NOT NULL DEFAULT 1,
    "guideDays" INTEGER NOT NULL DEFAULT 3,
    "watchTowerEnabled" BOOLEAN NOT NULL DEFAULT false,
    "watchTowerUrl" TEXT NOT NULL DEFAULT '',
    "watchTowerUsername" TEXT NOT NULL DEFAULT '',
    "watchTowerPassword" TEXT NOT NULL DEFAULT '',
    "watchTowerAutoSync" BOOLEAN NOT NULL DEFAULT false,
    "watchTowerSyncInterval" INTEGER NOT NULL DEFAULT 24,
    "watchTowerLastSync" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_settings" ("_id", "concurrentStreams", "createdAt", "ffmpegPath", "guideDays", "hdhrActive", "hdhrDeviceId", "hdhrFriendlyName", "hdhrTunerCount", "port", "updatedAt") SELECT "_id", "concurrentStreams", "createdAt", "ffmpegPath", "guideDays", "hdhrActive", "hdhrDeviceId", "hdhrFriendlyName", "hdhrTunerCount", "port", "updatedAt" FROM "settings";
DROP TABLE "settings";
ALTER TABLE "new_settings" RENAME TO "settings";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
