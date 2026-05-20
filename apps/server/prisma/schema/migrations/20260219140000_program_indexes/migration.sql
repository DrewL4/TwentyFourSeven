-- CreateIndex
CREATE INDEX "program_channelId_startTime_idx" ON "program"("channelId", "startTime");
CREATE INDEX "program_startTime_idx" ON "program"("startTime");
