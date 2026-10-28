import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * The user's own WatchTower API token, kept encrypted so 24/7 can send a request as them
 * (never as an admin). AES-256-GCM with a key derived from BETTER_AUTH_SECRET, which
 * start.sh creates once and keeps in /app/database. Without the secret nothing is stored.
 */
function tokenKey(secret = process.env.BETTER_AUTH_SECRET || ""): Buffer {
  if (!secret || secret === "auto-generated") {
    throw new Error("BETTER_AUTH_SECRET is not set; cannot protect WatchTower tokens");
  }
  return createHash("sha256").update(`tfs-wt-user-token-v1\0${secret}`).digest();
}

export function sealWatchTowerToken(token: string, secret?: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", tokenKey(secret), iv);
  const body = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), body.toString("base64url")].join(".");
}

/** The token, or null when the value is missing, tampered with, or sealed with another secret. */
export function openWatchTowerToken(sealed: string | null | undefined, secret?: string): string | null {
  if (!sealed) return null;
  const parts = sealed.split(".");
  if (parts.length !== 4 || parts[0] !== "v1") return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", tokenKey(secret), Buffer.from(parts[1], "base64url"));
    decipher.setAuthTag(Buffer.from(parts[2], "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(parts[3], "base64url")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
