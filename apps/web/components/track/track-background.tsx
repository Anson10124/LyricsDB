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
    <div aria-hidden className="pointer-events-none fixed inset-0 z-0">
      <motion.div
        initial={{ opacity: 0, scale: 1.08 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 1.6, ease: [0.16, 1, 0.3, 1] }}
        className="absolute inset-0"
      >
        {album && (
          <BackgroundRender
            album={album}
            albumIsVideo={albumIsVideo}
            playing={playing}
            fps={60}
            flowSpeed={1.5}
            renderScale={0.5}
            className="size-full"
          />
        )}
      </motion.div>
    </div>
  );
}
