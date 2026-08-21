export interface HttpOptions {
  headers?: Record<string, string>;
  timeout?: number;
  retries?: number;
  payload?: unknown;
}

export class HttpError extends Error {
  constructor(
    message: string,
    public status: number,
    public statusText: string,
    public url: string,
    public retryAfter?: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

const DEFAULT_TIMEOUT = 10000;
const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36";

export class HttpClient {
  static async get<T>(url: string, options?: HttpOptions): Promise<T> {
    return HttpClient.request<T>("GET", url, options);
  }

  static async post<T>(
    url: string,
    payload: unknown,
    options: HttpOptions = {},
  ): Promise<T> {
    return HttpClient.request<T>("POST", url, { ...options, payload });
  }

  static async resolveRedirect(url: string, maxRedirects = 5): Promise<string> {
    try {
      let currentUrl = url;
      for (let i = 0; i < maxRedirects; i++) {
        const response = await fetch(currentUrl, {
          method: "HEAD",
          redirect: "manual",
          headers: { "User-Agent": DEFAULT_USER_AGENT },
        });

        const location = response.headers.get("location");
        if (location && [301, 302, 303, 307, 308].includes(response.status)) {
          currentUrl = new URL(location, currentUrl).toString();
        } else {
          break;
        }
      }
      return currentUrl;
    } catch {
      return url;
    }
  }

  private static async request<T>(
    method: "GET" | "POST" | "PUT" | "DELETE",
    url: string,
    options?: HttpOptions,
  ): Promise<T> {
    const timeout = options?.timeout ?? DEFAULT_TIMEOUT;
    const retries = options?.retries ?? 2;

    let lastError: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      try {
        const headers: Record<string, string> = {
          "User-Agent": DEFAULT_USER_AGENT,
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,application/json,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
          ...options?.headers,
        };

        let body: string | URLSearchParams | undefined;
        if (options?.payload !== undefined && options?.payload !== null) {
          if (
            options.payload instanceof URLSearchParams ||
            typeof options.payload === "string"
          ) {
            body = options.payload;
          } else {
            headers["Content-Type"] =
              headers["Content-Type"] || "application/json";
            body = JSON.stringify(options.payload);
          }
        }

        const response = await fetch(url, {
          method,
          headers,
          body: method !== "GET" ? body : undefined,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          const retryAfter = response.headers.get("retry-after") ?? undefined;
          throw new HttpError(
            `HTTP ${response.status}: ${response.statusText}`,
            response.status,
            response.statusText,
            url,
            retryAfter,
          );
        }

        const text = await response.text();
        const trimmed = text.trim();
        const contentType = response.headers.get("content-type") ?? "";
        if (
          contentType.includes("application/json") ||
          contentType.includes("text/javascript") ||
          contentType.includes("application/javascript") ||
          (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
          (trimmed.startsWith("[") && trimmed.endsWith("]"))
        ) {
          try {
            return JSON.parse(trimmed) as T;
          } catch {
            return text as unknown as T;
          }
        }

        return text as unknown as T;
      } catch (error) {
        clearTimeout(timeoutId);
        lastError = error;

        const isLastAttempt = attempt === retries;
        if (!isLastAttempt) {
          const delay = (attempt + 1) * 1000;
          await new Promise((res) => setTimeout(res, delay));
          continue;
        }
      }
    }

    throw lastError;
  }
}
