/**
 * Live program for a channel, telling "no such channel" (404) apart from a
 * real channel with nothing playable right now. The video route used to
 * throw one generic error for both, which its catch-all turned into a 500.
 */

export class ChannelNotFoundError extends Error {
  readonly status = 404;
  constructor(readonly channelNumber: number) {
    super("Channel not found");
    this.name = "ChannelNotFoundError";
  }
}

export async function requireLiveProgram<T>(
  channelNumber: number,
  deps: {
    loadLive: (channelNumber: number) => Promise<T | null>;
    channelExists: (channelNumber: number) => Promise<boolean>;
  },
): Promise<T> {
  const live = await deps.loadLive(channelNumber);
  if (live) return live;
  if (!(await deps.channelExists(channelNumber))) {
    throw new ChannelNotFoundError(channelNumber);
  }
  throw new Error("Channel or program not found");
}

/** Status for an error out of the video route: 404 for a missing channel, else 500. */
export function videoErrorStatus(error: unknown): number {
  return error instanceof ChannelNotFoundError ? 404 : 500;
}
