export type BuildInfo = { version: string; revision: string; build_date: string };

/** Public build info passed in by CI as build args (APP_VERSION/GIT_SHA/BUILD_DATE). "dev" when unset. */
export function getBuildInfo(env: Record<string, string | undefined> = process.env): BuildInfo {
  return {
    version: env.APP_VERSION?.trim() || "dev",
    revision: env.GIT_SHA?.trim() || "",
    build_date: env.BUILD_DATE?.trim() || "",
  };
}
