"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";
import { getApiBaseUrl } from "@/lib/api-client";

interface LiveActivityToasterProps {
  enabled?: boolean;
  ignoredTrackIds?: string[];
}

export function LiveActivityToaster({
  enabled = true,
  ignoredTrackIds = [],
}: LiveActivityToasterProps) {
  const router = useRouter();
  const pathname = usePathname();
  const eventSourceRef = useRef<EventSource | null>(null);
  const enabledRef = useRef(enabled);
  const ignoredRef = useRef(ignoredTrackIds);

  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  useEffect(() => {
    ignoredRef.current = ignoredTrackIds;
  }, [ignoredTrackIds]);

  useEffect(() => {
    // Only listen and show toasts on root main page ("/")
    if (pathname !== "/") {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      return;
    }

    let reconnectTimeout: NodeJS.Timeout | null = null;
    let isMounted = true;

    function connect() {
      if (!isMounted) return;

      const apiBase = getApiBaseUrl();
      const streamUrl = `${apiBase}/api/activity/stream`;
      const es = new EventSource(streamUrl);
      eventSourceRef.current = es;

      es.onmessage = (messageEvent) => {
        if (!isMounted) return;
        try {
          const payload = JSON.parse(messageEvent.data);
          const { type, track, event } = payload;

          // Only toast when enabled (e.g. on search view) and for newly added tracks
          if (type === "added" && enabledRef.current) {
            const trackData = track || event?.track;
            if (!trackData) return;

            // Skip toast if it's the track the user themselves just resolved/viewed
            if (
              trackData.id &&
              ignoredRef.current.includes(trackData.id)
            ) {
              return;
            }

            const title = trackData.title || "Unknown Track";
            const artist =
              trackData.artist ||
              (Array.isArray(trackData.artists)
                ? trackData.artists.join(", ")
                : "Unknown Artist");
            const description = `${title} • ${artist}`;

            const action = trackData.id
              ? {
                  label: "View",
                  onClick: () => router.push(`/track/${trackData.id}`),
                }
              : undefined;

            toast.success("New Track Available", {
              description,
              action,
            });
          }
        } catch (err) {
          console.error("Failed to parse activity event:", err);
        }
      };

      es.onerror = () => {
        if (!isMounted) return;
        es.close();
        eventSourceRef.current = null;
        reconnectTimeout = setTimeout(connect, 5000);
      };
    }

    connect();

    return () => {
      isMounted = false;
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };
  }, [pathname, router]);

  return null;
}
