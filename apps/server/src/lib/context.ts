import type { NextRequest } from "next/server";
import { auth } from "./auth";
import prisma from "../../prisma";

// Export the database instance for use across the application
export const db = prisma;

export async function createContext(req: NextRequest) {
  const session = await auth.api.getSession({
    headers: req.headers,
  });
  return {
    session,
    db: prisma,
  };
}

export type Context = Awaited<ReturnType<typeof createContext>>;
