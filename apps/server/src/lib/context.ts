import type { NextRequest } from "next/server";
import { auth } from "./auth";
import prisma from "../../prisma";
import { clientAddress } from "./link-security";

// Export the database instance for use across the application
export const db = prisma;

export async function createContext(req: NextRequest) {
  const session = await auth.api.getSession({
    headers: req.headers,
  });

  return {
    session,
    db: prisma,
    ip: clientAddress(req.headers),
    userAgent: (req.headers.get("user-agent") || "").slice(0, 200),
  };
}

type CreatedContext = Awaited<ReturnType<typeof createContext>>;
/** `ip` and `userAgent` are optional so tests can build a context by hand. */
export type Context = Omit<CreatedContext, "ip" | "userAgent"> & { ip?: string; userAgent?: string };
