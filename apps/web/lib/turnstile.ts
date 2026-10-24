import { fetchTurnstileConfig } from "@/lib/api-client";

interface TurnstileRenderOptions {
  sitekey: string;
  action?: string;
  appearance?: "always" | "execute" | "interaction-only";
  "refresh-expired"?: "auto" | "manual" | "never";
  callback?: (token: string) => void;
  "error-callback"?: (code: string) => boolean | void;
  "expired-callback"?: () => void;
  "timeout-callback"?: () => void;
}

interface TurnstileApi {
  render: (container: HTMLElement, options: TurnstileRenderOptions) => string;
  remove: (widgetId: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT_URL =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

let siteKeyPromise: Promise<string | null> | null = null;
let scriptPromise: Promise<TurnstileApi> | null = null;

/**
 * Resolves the site key from the API (null means human verification is off).
 */
export function getTurnstileSiteKey(): Promise<string | null> {
  siteKeyPromise ??= fetchTurnstileConfig()
    .then((config) => config.siteKey)
    .catch((err) => {
      // Let the next call retry; the API still enforces checks if enabled
      siteKeyPromise = null;
      throw err;
    });
  return siteKeyPromise;
}

function loadTurnstileScript(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);

  scriptPromise ??= new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT_URL;
    script.async = true;
    script.onload = () => {
      if (window.turnstile) resolve(window.turnstile);
      else reject(new Error("Turnstile failed to initialise."));
    };
    script.onerror = () => {
      scriptPromise = null;
      script.remove();
      reject(new Error("Could not load the human verification check."));
    };
    document.head.appendChild(script);
  });
  return scriptPromise;
}

/**
 * Runs a fresh Turnstile challenge inside `container` and returns its
 * single-use token, or undefined when Turnstile is not configured.
 * The widget is removed afterwards so every action gets a new challenge.
 */
export async function getTurnstileToken(
  container: HTMLElement,
  action: string,
): Promise<string | undefined> {
  const siteKey = await getTurnstileSiteKey();
  if (!siteKey) return undefined;

  const turnstile = await loadTurnstileScript();

  return new Promise<string>((resolve, reject) => {
    let widgetId: string | undefined;
    const done = (fn: () => void) => {
      if (widgetId) turnstile.remove(widgetId);
      widgetId = undefined;
      fn();
    };

    widgetId = turnstile.render(container, {
      sitekey: siteKey,
      action,
      appearance: "interaction-only",
      "refresh-expired": "never",
      callback: (token) => done(() => resolve(token)),
      "error-callback": () => {
        done(() => reject(new Error("Human verification failed. Please try again.")));
        return true;
      },
      "expired-callback": () =>
        done(() => reject(new Error("Human verification expired. Please try again."))),
      "timeout-callback": () =>
        done(() => reject(new Error("Human verification timed out. Please try again."))),
    });
  });
}
