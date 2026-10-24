/**
 * One guide build at a time. Requests that miss the cache while a build is running share it
 * instead of each loading every programme again (N clients after expiry = N full copies in
 * heap). A caller that needs data newer than the running build (bypass-cache=true, or the cache
 * was invalidated after that build started) waits for one shared follow-up build.
 */
export function createBuildOnce(build: () => Promise<void>, generation: () => number) {
  let building: { gen: number; done: Promise<void> } | null = null;
  let queued: Promise<void> | null = null;
  const start = (): Promise<void> => {
    const entry = { gen: generation(), done: Promise.resolve() };
    entry.done = build().finally(() => {
      if (building === entry) building = null;
    });
    building = entry;
    return entry.done;
  };
  return function rebuild(needFresh: boolean): Promise<void> {
    if (!building) return start();
    if (!needFresh && building.gen === generation()) return building.done;
    if (!queued) {
      queued = building.done
        .catch(() => undefined)
        .then(() => {
          queued = null;
          return building ? building.done : start();
        });
    }
    return queued;
  };
}
