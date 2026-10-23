import type { LocalScanState } from "./scanner";

const n = (v: number) => v.toLocaleString("en-US");
const plural = (v: number, one: string, many: string) => `${n(v)} ${v === 1 ? one : many}`;
const joinPaths = (paths: string[]) =>
  paths.length <= 1 ? paths.join("") : `${paths.slice(0, -1).join(", ")} and ${paths[paths.length - 1]}`;

/**
 * `setup` tells the page which helper to show:
 * - "map-folders": the container can't see any media folder yet (show the Unraid steps).
 * - "pick-folders": a folder is mapped but nothing is chosen in it yet (show Find my videos).
 */
export type FriendlyStatus = {
  tone: "ok" | "working" | "problem";
  message: string;
  fixes: string[];
  setup?: "map-folders" | "pick-folders";
};

/** One plain sentence about the local folders, plus what to do when something is off. */
export function describeLocalStatus(
  state: LocalScanState,
  opts: { enabled: boolean; mapped?: string[] },
): FriendlyStatus {
  if (!opts.enabled) return { tone: "ok", message: "Local files are turned off.", fixes: [] };
  if (state.running && state.folders.length === 0) {
    return { tone: "working", message: "Looking through your video folders…", fixes: [] };
  }
  if (!state.finishedAt && state.folders.length === 0) {
    return { tone: "working", message: "Getting ready to look through your video folders…", fixes: [] };
  }
  if (state.folders.length === 0) {
    if (opts.mapped && opts.mapped.length > 0) {
      return {
        tone: "problem",
        message: "Pick the folders that have your movies and TV shows.",
        fixes: ["Press Find my videos and TwentyFourSeven will look for them, or press Browse to pick them yourself."],
        setup: "pick-folders",
      };
    }
    return {
      tone: "problem",
      message: "TwentyFourSeven can't see your video folders yet.",
      fixes: ["Your server has to share them with TwentyFourSeven once. It takes about a minute; the steps are below."],
      setup: "map-folders",
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
