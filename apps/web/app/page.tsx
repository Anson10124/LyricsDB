"use client";

import { useEffect, useRef, useState } from "react";
import { InputBar } from "@/components/input-bar";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

export default function Home() {
  const [logs, setLogs] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);

  const handleSearch = (url: string) => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    setLogs([]);
    setIsLoading(true);

    const streamUrl = `${API_BASE_URL}/api/lyrics/stream?url=${encodeURIComponent(url)}`;
    const es = new EventSource(streamUrl);
    eventSourceRef.current = es;

    es.onmessage = (event) => {
      setLogs((prev) => [...prev, event.data]);

      try {
        const parsed = JSON.parse(event.data);
        if (parsed.stage === "done" || parsed.stage === "error") {
          es.close();
          setIsLoading(false);
        }
      } catch {
        // ignore JSON parse errors
      }
    };

    es.onerror = () => {
      es.close();
      setIsLoading(false);
    };
  };

  useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, []);

  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center bg-background text-foreground px-4 py-12">
      <div className="flex flex-col items-center gap-3 text-center mb-6 max-w-lg z-10">
        <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight">
          Lyrics<span className="text-primary">DB</span>
        </h1>

        <p className="text-sm md:text-base text-muted-foreground">
          Search your favorite song or paste in a link from Spotify, Apple Music, or Deezer to get the lyrics instantly
        </p>
      </div>

      <InputBar onSearch={handleSearch} isLoading={isLoading} />

      {logs.length > 0 && (
        <div className="w-full max-w-2xl mt-6 space-y-1">
          {logs.map((log, index) => (
            <p key={index} className="text-xs font-mono text-muted-foreground break-all">
              {log}
            </p>
          ))}
        </div>
      )}
    </main>
  );
}