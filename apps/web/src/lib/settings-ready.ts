// The Settings page loads from two places: its own settings and the "where are your
// videos" card's status. If the page draws before both are in, the video card grows
// after the first paint and pushes every card below it down, so a click aimed at one
// card lands on the one above. Keep the (spinner-style) placeholders up until both
// are loaded, and make the card reserve its space while it loads.
export function settingsPageIsLoading(state: { settingsLoading: boolean; mediaStatusLoading: boolean }): boolean {
  return state.settingsLoading || state.mediaStatusLoading;
}
