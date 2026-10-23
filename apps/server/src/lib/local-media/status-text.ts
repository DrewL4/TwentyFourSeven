import type { LocalScanState } from "./scanner";

const n = (v: number) => v.toLocaleString("en-US");
const plural = (v: number, one: string, many: string) => `${n(v)} ${v === 1 ? one : many}`;
const joinPaths = (paths: string[]) =>
  paths.length <= 1 ? paths.join("") : `${paths.slice(0, -1).join(", ")} and ${paths[paths.length - 1]}`;

export type FriendlyStatus = { tone: "ok" | "working" | "problem"; message: string; fixes: string[] };

/** One plain sentence about the local folders, plus what to do when something is off. */
export function describeLocalStatus(state: LocalScanState, opts: { enabled: boolean }): FriendlyStatus {
  if (!opts.enabled) return { tone: "ok", message: "Local files are turned off.", fixes: [] };
  if (state.running && state.folders.length === 0) {
    return { tone: "working", message: "Looking through your video folders…", fixes: [] };
  }
  if (!state.finishedAt && state.folders.length === 0) {
    return { tone: "working", message: "Getting ready to look through your video folders…", fixes: [] };
  }
  if (state.folders.length === 0) {
    return {
      tone: "problem",
      message: "No video folders were found.",
      fixes: [
        "In your container settings, map your movies folder to /movies and your TV folder to /tv. Read-only is fine.",
        "Then press Scan now.",
      ],
    };
  }

  const fixes: string[] = [];
  for (const f of state.folders) {
    if (f.problem === "missing") fixes.push(`TwentyFourSeven can't open ${f.path}. Check that it is mapped in your container settings.`);
    else if (f.problem === "not-a-folder") fixes.push(`${f.path} is a file, not a folder.`);
    else if (f.problem === "empty") fixes.push(`${f.path} has no videos. Check that it points at the right folder on your server.`);
  }
  const good = state.folders.filter((f) => f.ok && !f.problem);
  const movies = good.reduce((a, f) => a + f.movies, 0);
  const shows = good.reduce((a, f) => a + f.shows, 0);
  const counts = [movies ? plural(movies, "movie", "movies") : "", shows ? plural(shows, "show", "shows") : ""].filter(Boolean);

  if (counts.length === 0) {
    return { tone: "problem", message: "No videos were found in your folders yet.", fixes };
  }
  const prefix = state.running ? "Updating… found" : "Found";
  return {
    tone: fixes.length ? "problem" : state.running ? "working" : "ok",
    message: `${prefix} ${counts.join(" and ")} in ${joinPaths(good.map((f) => f.path))}`,
    fixes,
  };
}
