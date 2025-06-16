-- CreateTable
CREATE TABLE "user" (
    "_id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" BOOLEAN NOT NULL,
    "image" TEXT,
    "createdAt" DATETIME NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "session" (
    "_id" TEXT NOT NULL PRIMARY KEY,
    "expiresAt" DATETIME NOT NULL,
    "token" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL,
    "updatedAt" DATETIME NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "userId" TEXT NOT NULL,
    CONSTRAINT "session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user" ("_id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "account" (
    "_id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "idToken" TEXT,
    "accessTokenExpiresAt" DATETIME,
    "refreshTokenExpiresAt" DATETIME,
    "scope" TEXT,
    "password" TEXT,
    "createdAt" DATETIME NOT NULL,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user" ("_id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "verification" (
    "_id" TEXT NOT NULL PRIMARY KEY,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME,
    "updatedAt" DATETIME
);

-- CreateTable
CREATE TABLE "media_server" (
    "_id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "token" TEXT,
    "type" TEXT NOT NULL DEFAULT 'PLEX',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "media_library" (
    "_id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "serverId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "media_library_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "media_server" ("_id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "media_show" (
    "_id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "year" INTEGER,
    "summary" TEXT,
    "poster" TEXT,
    "backdrop" TEXT,
    "ratingKey" TEXT NOT NULL,
    "studio" TEXT,
    "contentRating" TEXT,
    "genres" TEXT,
    "directors" TEXT,
    "writers" TEXT,
    "actors" TEXT,
    "countries" TEXT,
    "libraryId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "media_show_libraryId_fkey" FOREIGN KEY ("libraryId") REFERENCES "media_library" ("_id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "media_episode" (
    "_id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "duration" INTEGER NOT NULL,
    "seasonNumber" INTEGER NOT NULL,
    "episodeNumber" INTEGER NOT NULL,
    "thumb" TEXT,
    "ratingKey" TEXT NOT NULL,
    "showId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "media_episode_showId_fkey" FOREIGN KEY ("showId") REFERENCES "media_show" ("_id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "media_movie" (
    "_id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "year" INTEGER,
    "summary" TEXT,
    "poster" TEXT,
    "backdrop" TEXT,
    "duration" INTEGER NOT NULL,
    "ratingKey" TEXT NOT NULL,
    "studio" TEXT,
    "contentRating" TEXT,
    "genres" TEXT,
    "directors" TEXT,
    "writers" TEXT,
    "actors" TEXT,
    "countries" TEXT,
    "libraryId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "media_movie_libraryId_fkey" FOREIGN KEY ("libraryId") REFERENCES "media_library" ("_id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "channel" (
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "program" (
    "_id" TEXT NOT NULL PRIMARY KEY,
    "channelId" TEXT NOT NULL,
    "episodeId" TEXT,
    "movieId" TEXT,
    "startTime" DATETIME NOT NULL,
    "duration" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "program_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "channel" ("_id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "program_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "media_episode" ("_id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "program_movieId_fkey" FOREIGN KEY ("movieId") REFERENCES "media_movie" ("_id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "channel_show" (
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "channel_show_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "channel" ("_id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "channel_show_showId_fkey" FOREIGN KEY ("showId") REFERENCES "media_show" ("_id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "channel_movie" (
    "_id" TEXT NOT NULL PRIMARY KEY,
    "channelId" TEXT NOT NULL,
    "movieId" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "weight" INTEGER NOT NULL DEFAULT 1,
    "shuffle" BOOLEAN NOT NULL DEFAULT false,
    "maxConsecutiveMovies" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "channel_movie_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "channel" ("_id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "channel_movie_movieId_fkey" FOREIGN KEY ("movieId") REFERENCES "media_movie" ("_id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "settings" (
    "_id" TEXT NOT NULL PRIMARY KEY DEFAULT 'singleton',
    "port" INTEGER NOT NULL DEFAULT 3000,
    "ffmpegPath" TEXT NOT NULL DEFAULT 'ffmpeg',
    "concurrentStreams" INTEGER NOT NULL DEFAULT 1,
    "hdhrActive" BOOLEAN NOT NULL DEFAULT false,
    "hdhrDeviceId" TEXT NOT NULL DEFAULT '',
    "hdhrFriendlyName" TEXT NOT NULL DEFAULT 'My TV Server',
    "hdhrTunerCount" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "plex_settings" (
    "_id" TEXT NOT NULL PRIMARY KEY DEFAULT 'singleton',
    "url" TEXT NOT NULL DEFAULT '',
    "token" TEXT NOT NULL DEFAULT '',
    "settingsId" TEXT NOT NULL DEFAULT 'singleton',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "plex_settings_settingsId_fkey" FOREIGN KEY ("settingsId") REFERENCES "settings" ("_id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "user_email_key" ON "user"("email");

-- CreateIndex
CREATE UNIQUE INDEX "session_token_key" ON "session"("token");

-- CreateIndex
CREATE UNIQUE INDEX "media_library_serverId_key_key" ON "media_library"("serverId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "media_show_libraryId_ratingKey_key" ON "media_show"("libraryId", "ratingKey");

-- CreateIndex
CREATE UNIQUE INDEX "media_episode_showId_ratingKey_key" ON "media_episode"("showId", "ratingKey");

-- CreateIndex
CREATE UNIQUE INDEX "media_movie_libraryId_ratingKey_key" ON "media_movie"("libraryId", "ratingKey");

-- CreateIndex
CREATE UNIQUE INDEX "channel_number_key" ON "channel"("number");

-- CreateIndex
CREATE UNIQUE INDEX "channel_show_channelId_showId_key" ON "channel_show"("channelId", "showId");

-- CreateIndex
CREATE UNIQUE INDEX "channel_movie_channelId_movieId_key" ON "channel_movie"("channelId", "movieId");

-- CreateIndex
CREATE UNIQUE INDEX "plex_settings_settingsId_key" ON "plex_settings"("settingsId");
