import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import prisma from "../../prisma";

// Parse trusted origins from environment variable
const getTrustedOrigins = () => {
  const trustedOrigins = process.env.TRUSTED_ORIGINS || process.env.CORS_ORIGIN || "";
  return trustedOrigins.split(",").map(origin => origin.trim()).filter(Boolean);
};

export const auth = betterAuth({
  database: prismaAdapter(prisma, {
    provider: "sqlite"
  }),
  trustedOrigins: getTrustedOrigins(),
  emailAndPassword: {
    enabled: true,
  }
});

// Export auth options for compatibility with next-auth patterns
export const authOptions = {
  adapter: prismaAdapter(prisma, { provider: "sqlite" }),
  providers: [],
  session: { strategy: "jwt" },
  pages: {
    signIn: "/login",
  },
};



