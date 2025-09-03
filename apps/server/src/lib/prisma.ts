import { PrismaClient } from "../../prisma/generated";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma = globalForPrisma.prisma ?? new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
});

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

// Cleanup function for graceful shutdown
export async function disconnectPrisma() {
  try {
    console.log('🔌 Disconnecting Prisma client...');
    await prisma.$disconnect();
    console.log('✅ Prisma client disconnected successfully');
  } catch (error) {
    console.error('❌ Error disconnecting Prisma client:', error);
  }
}

// Handle process termination signals for cleanup
if (typeof process !== 'undefined') {
  process.on('SIGINT', async () => {
    await disconnectPrisma();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    await disconnectPrisma();
    process.exit(0);
  });

  process.on('beforeExit', async () => {
    await disconnectPrisma();
  });
} 