-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_plex_settings" (
    "_id" TEXT NOT NULL PRIMARY KEY DEFAULT 'singleton',
    "url" TEXT NOT NULL DEFAULT '',
    "token" TEXT NOT NULL DEFAULT '',
    "autoRefreshLibraries" BOOLEAN NOT NULL DEFAULT false,
    "refreshInterval" INTEGER NOT NULL DEFAULT 24,
    "arGuide" BOOLEAN NOT NULL DEFAULT false,
    "arChannels" BOOLEAN NOT NULL DEFAULT false,
    "connectionTimeout" INTEGER NOT NULL DEFAULT 10000,
    "requestTimeout" INTEGER NOT NULL DEFAULT 30000,
    "settingsId" TEXT NOT NULL DEFAULT 'singleton',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "plex_settings_settingsId_fkey" FOREIGN KEY ("settingsId") REFERENCES "settings" ("_id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_plex_settings" ("_id", "createdAt", "settingsId", "token", "updatedAt", "url") SELECT "_id", "createdAt", "settingsId", "token", "updatedAt", "url" FROM "plex_settings";
DROP TABLE "plex_settings";
ALTER TABLE "new_plex_settings" RENAME TO "plex_settings";
CREATE UNIQUE INDEX "plex_settings_settingsId_key" ON "plex_settings"("settingsId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
