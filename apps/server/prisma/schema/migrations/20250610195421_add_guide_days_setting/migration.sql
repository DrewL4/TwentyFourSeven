-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_settings" ("_id", "concurrentStreams", "createdAt", "ffmpegPath", "hdhrActive", "hdhrDeviceId", "hdhrFriendlyName", "hdhrTunerCount", "port", "updatedAt") SELECT "_id", "concurrentStreams", "createdAt", "ffmpegPath", "hdhrActive", "hdhrDeviceId", "hdhrFriendlyName", "hdhrTunerCount", "port", "updatedAt" FROM "settings";
DROP TABLE "settings";
ALTER TABLE "new_settings" RENAME TO "settings";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
