-- CreateTable
CREATE TABLE "webhook_activity" (
    "_id" TEXT NOT NULL PRIMARY KEY,
    "source" TEXT NOT NULL,
    "serverName" TEXT NOT NULL,
    "serverId" TEXT,
    "eventType" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "contentTitle" TEXT NOT NULL,
    "contentId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "errorMessage" TEXT,
    "payload" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
