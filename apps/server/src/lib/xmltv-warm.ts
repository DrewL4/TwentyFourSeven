let warmInFlight: Promise<void> | null = null;
let warmDebounceTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Debounced background XMLTV regen so the first client after invalidation avoids a cold miss.
 * Enabled when XMLTV_WARM_ON_INVALIDATE=true.
 */
export function scheduleXmlTvWarm(baseUrl?: string): void {
  if (process.env.XMLTV_WARM_ON_INVALIDATE !== "true") {
    return;
  }

  if (warmDebounceTimer) {
    clearTimeout(warmDebounceTimer);
  }

  warmDebounceTimer = setTimeout(() => {
    warmDebounceTimer = null;
    if (warmInFlight) {
      return;
    }

    const origin =
      baseUrl ||
      process.env.NEXT_PUBLIC_SERVER_URL ||
      `http://127.0.0.1:${process.env.PORT || process.env.SERVER_PORT || "3000"}`;

    warmInFlight = fetch(`${origin.replace(/\/$/, "")}/media.xml?bypass-cache=true`, {
      headers: { Accept: "application/xml" },
    })
      .then(() => undefined)
      .catch((error) => {
        console.warn("[XMLTV] Background warm failed:", error);
      })
      .finally(() => {
        warmInFlight = null;
      });
  }, 2000);
}
