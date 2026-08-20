"use client";

import { InputBar } from "@/components/input-bar";

export default function Home() {
  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center bg-background text-foreground overflow-hidden px-4">
      <div
        className="flex flex-col items-center gap-3 text-center mb-6 max-w-lg z-10"
      >
        <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight">
          Lyrics<span className="text-primary">DB</span>
        </h1>

        <p className="text-sm md:text-base text-muted-foreground">
          Search your favorite song or paste in a link from Spotify, Apple Music, or Deezer to get the lyrics instantly
        </p>
      </div>
      <InputBar />
    </main>
  );
}