-- CreateTable
CREATE TABLE "audit_outbox" (
    "_id" TEXT NOT NULL PRIMARY KEY,
    "eventId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" DATETIME
);

-- CreateIndex
CREATE UNIQUE INDEX "audit_outbox_eventId_key" ON "audit_outbox"("eventId");

-- CreateIndex
CREATE INDEX "audit_outbox_sentAt_createdAt_idx" ON "audit_outbox"("sentAt", "createdAt");
