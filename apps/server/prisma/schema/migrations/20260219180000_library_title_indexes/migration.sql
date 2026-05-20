-- CreateIndex
CREATE INDEX "media_show_libraryId_title_idx" ON "media_show"("libraryId", "title");
CREATE INDEX "media_show_title_idx" ON "media_show"("title");

-- CreateIndex
CREATE INDEX "media_movie_libraryId_title_idx" ON "media_movie"("libraryId", "title");
CREATE INDEX "media_movie_title_idx" ON "media_movie"("title");
