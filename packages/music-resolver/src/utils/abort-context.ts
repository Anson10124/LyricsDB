import { AsyncLocalStorage } from "node:async_hooks";

// Ambient cancellation signal for upstream work. The API runs each live sync
// inside runWithAbortSignal(), and HttpClient and the provider limiter read it
// from here, so a deadline or client disconnect stops queued and retried
// requests without threading a signal through every adapter and fetcher.
const storage = new AsyncLocalStorage<AbortSignal | undefined>();

export function runWithAbortSignal<T>(signal: AbortSignal, fn: () => T): T {
  return storage.run(signal, fn);
}

// For work shared between callers (e.g. a token refresh) that must not be
// cancelled because the caller that happened to start it went away.
export function runWithoutAbortSignal<T>(fn: () => T): T {
  return storage.run(undefined, fn);
}

export function currentAbortSignal(): AbortSignal | undefined {
  return storage.getStore();
}

export function throwIfAborted(): void {
  currentAbortSignal()?.throwIfAborted();
}

// Rejects with the signal's reason once it aborts; use with Promise.race so a
// deadline holds even if some inner step ignores the signal.
export function rejectOnAbort(signal: AbortSignal): Promise<never> {
  return new Promise<never>((_, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    signal.addEventListener("abort", () => reject(signal.reason), {
      once: true,
    });
  });
}
