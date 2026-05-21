export function normalizeTitle(input: string): string {
  return input
    .toLowerCase()
    .replace(/\(.*?\)/g, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
