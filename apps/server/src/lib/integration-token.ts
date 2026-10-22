import { createHash, timingSafeEqual } from 'crypto';

/** Constant-time compare of a presented integration token against the stored one. */
export function integrationTokenMatches(presented: string | null, stored: string | null | undefined): boolean {
  if (!presented || !stored) return false;
  const a = createHash('sha256').update(presented).digest();
  const b = createHash('sha256').update(stored).digest();
  return timingSafeEqual(a, b);
}
