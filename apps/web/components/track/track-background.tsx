"use client";

import dynamic from "next/dynamic";
import { motion } from "motion/react";

const BackgroundRender = dynamic(
  () =>
    import("@applemusic-like-lyrics/react").then((mod) => mod.BackgroundRender),
  { ssr: false },
);

interface TrackBackgroundProps {
  imageCover?: string;
  videoCover?: string;
  playing: boolean;
}

/**
 * Full-page flowing gradient sampled from the album art (one WebGL renderer for
 * the whole page). Falls back to a static amber wash when there's no artwork.
 */
export function TrackBackground({
  imageCover,
  videoCover,
  playing,
}: TrackBackgroundProps) {
  // The gradient is sampled from a single frame, so a video adds nothing but
  // a slower load. Use the still image and keep the video for the cover.
  const album = imageCover || videoCover;
  const albumIsVideo = !imageCover && Boolean(videoCover);

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-0 bg-black">
      <motion.div
        initial={{ opacity: 0, scale: 1.08 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 1.6, ease: [0.16, 1, 0.3, 1] }}
        className="absolute inset-0"
      >
        {album ? (
          <BackgroundRender
            album={album}
            albumIsVideo={albumIsVideo}
            playing={playing}
            fps={60}
            flowSpeed={1.5}
            renderScale={0.5}
            className="size-full"
          />
        ) : (
          <div className="size-full bg-[radial-gradient(ellipse_at_20%_10%,oklch(0.55_0.12_75/0.55),transparent_60%),radial-gradient(ellipse_at_85%_90%,oklch(0.4_0.08_40/0.6),transparent_60%)]" />
        )}
      </motion.div>
      {/* Keeps white text readable on bright covers */}
      <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-black/15 to-black/45" />
    </div>
  );
}
