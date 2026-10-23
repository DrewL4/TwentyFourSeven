import { readFileSync } from "node:fs";

export type BuildInfo = { version: string; revision: string; build_date: string };

/** Written by the Docker build. Survives container updates that copy old env vars. */
export const BUILD_INFO_FILE = "/app/build-info.json";

function readBuildFile(path: string): Partial<Record<keyof BuildInfo, unknown>> | null {
  try {
    const data = JSON.parse(readFileSync(path, "utf8"));
    return data && typeof data === "object" ? data : null;
  } catch {
    return null;
  }
}

const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/**
 * Public build info. The image's build-info.json wins; the APP_VERSION/GIT_SHA/
 * BUILD_DATE env vars are only a fallback (older images, local runs). "dev" when unset.
 */
export function getBuildInfo(
  env: Record<string, string | undefined> = process.env,
  file: string = env.TFS_BUILD_INFO_FILE || BUILD_INFO_FILE,
): BuildInfo {
  const built = readBuildFile(file);
  if (built && text(built.version)) {
    return { version: text(built.version), revision: text(built.revision), build_date: text(built.build_date) };
  }
  return {
    version: env.APP_VERSION?.trim() || "dev",
    revision: env.GIT_SHA?.trim() || "",
    build_date: env.BUILD_DATE?.trim() || "",
  };
}
