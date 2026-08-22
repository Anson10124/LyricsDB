import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { isStreamingUrl as checkStreamingUrl } from "@repo/music-resolver/platforms";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Formats a duration in milliseconds or seconds into a mm:ss display string.
 */
export function formatDuration(
  duration?: number,
  unit: "ms" | "s" = "ms",
): string {
  if (!duration || duration <= 0) return "0:00";
  const totalSeconds = Math.floor(
    unit === "ms" ? duration / 1000 : duration,
  );
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

/**
 * Checks if a string is a streaming platform URL or URI.
 */
export function isStreamingUrl(text: string): boolean {
  return checkStreamingUrl(text);
}
