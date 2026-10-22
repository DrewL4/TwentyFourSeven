/** Fixed answer for HDHomeRun /lineup_status.json: no scan running, cable source. */
export function buildLineupStatus() {
  return {
    ScanInProgress: 0,
    ScanPossible: 1,
    Source: "Cable",
    SourceList: ["Cable"],
  };
}
