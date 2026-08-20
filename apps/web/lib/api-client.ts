/**
 * Resolves the API base URL with smart auto-detection.
 *
 * Auto-detection strategy:
 * 1. Explicit `NEXT_PUBLIC_API_URL` if provided (e.g. separate API subdomain).
 * 2. In browser runtime (`window !== undefined`):
 *    - Returns empty string `""` so requests are relative to current domain/origin (`/api/...`).
 * 3. In server-side runtime (SSR):
 *    - Returns `API_INTERNAL_URL` (defaults to Docker service `http://api:4000` in production or `http://localhost:4000` in development).
 */
export function getApiBaseUrl(): string {
  if (process.env.NEXT_PUBLIC_API_URL) {
    return process.env.NEXT_PUBLIC_API_URL.replace(/\/$/, "");
  }

  if (typeof window !== "undefined") {
    // Client-side browser: use relative path for automatic host/port/protocol detection
    return "";
  }

  // Server-side (Node.js runtime / SSR)
  return (
    process.env.API_INTERNAL_URL ||
    (process.env.NODE_ENV === "production"
      ? "http://api:4000"
      : "http://localhost:4000")
  );
}
