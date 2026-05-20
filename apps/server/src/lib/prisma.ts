import { PrismaClient } from "../../prisma/generated/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
  sqlitePragmasInitialized?: boolean;
};

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

/** Enable WAL for concurrent reads during XMLTV / UI access */
export async function initSqlitePragmas(): Promise<void> {
  if (globalForPrisma.sqlitePragmasInitialized) {
    return;
  }
  const url = process.env.DATABASE_URL ?? "";
  if (!url.startsWith("file:")) {
    globalForPrisma.sqlitePragmasInitialized = true;
    return;
  }
  // Many PRAGMAs return a row on SQLite; use $queryRawUnsafe (not $executeRawUnsafe).
  const pragma = (sql: string) => prisma.$queryRawUnsafe(sql);
  await pragma("PRAGMA journal_mode=WAL;");
  await pragma("PRAGMA synchronous=NORMAL;");
  await pragma("PRAGMA cache_size=-64000;");
  await pragma("PRAGMA mmap_size=268435456;");
  await pragma("PRAGMA temp_store=MEMORY;");
  globalForPrisma.sqlitePragmasInitialized = true;
} 