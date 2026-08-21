"use client";

import { useEffect, useRef } from "react";
import { useSetAtom } from "jotai";
import type { SanitizedTrack, TrackRecord } from "@repo/types";
import type { LyricLine } from "@applemusic-like-lyrics/core";
import {
  PrebuiltLyricPlayer,
  musicIdAtom,
  musicNameAtom,
  musicArtistsAtom,
  musicAlbumNameAtom,
  musicCoverAtom,
  musicCoverIsVideoAtom,
  musicDurationAtom,
  musicPlayingAtom,
  musicPlayingPositionAtom,
  musicLyricLinesAtom,
  isLyricPageOpenedAtom,
  onClickControlThumbAtom,
  onPlayOrResumeAtom,
  onSeekPositionAtom,
  onLyricLineClickAtom,
  onRequestPrevSongAtom,
} from "@applemusic-like-lyrics/react-full";
import "@applemusic-like-lyrics/react-full/style.css";

interface AmllFullscreenPlayerProps {
  track: SanitizedTrack<TrackRecord>;
  lyricLines: LyricLine[];
  isPlaying: boolean;
  currentTime: number;
  durationMs: number;
  onClose: () => void;
  onTogglePlay: () => void;
  onSeek: (position: number) => void;
}

export function AmllFullscreenPlayer({
  track,
  lyricLines,
  isPlaying,
  currentTime,
  durationMs,
  onClose,
  onTogglePlay,
  onSeek,
}: AmllFullscreenPlayerProps) {
  const setMusicId = useSetAtom(musicIdAtom);
  const setMusicName = useSetAtom(musicNameAtom);
  const setMusicArtists = useSetAtom(musicArtistsAtom);
  const setMusicAlbumName = useSetAtom(musicAlbumNameAtom);
  const setMusicCover = useSetAtom(musicCoverAtom);
  const setMusicCoverIsVideo = useSetAtom(musicCoverIsVideoAtom);
  const setMusicDuration = useSetAtom(musicDurationAtom);
  const setMusicLyricLines = useSetAtom(musicLyricLinesAtom);
  const setMusicPlaying = useSetAtom(musicPlayingAtom);
  const setMusicPlayingPosition = useSetAtom(musicPlayingPositionAtom);
  const setIsLyricPageOpened = useSetAtom(isLyricPageOpenedAtom);

  const setOnClickControlThumb = useSetAtom(onClickControlThumbAtom);
  const setOnPlayOrResume = useSetAtom(onPlayOrResumeAtom);
  const setOnSeekPosition = useSetAtom(onSeekPositionAtom);
  const setOnLyricLineClick = useSetAtom(onLyricLineClickAtom);
  const setOnRequestPrevSong = useSetAtom(onRequestPrevSongAtom);

  // Store latest callbacks and values in a ref so effects and listeners don't re-run
  const stateRef = useRef({
    onClose,
    onTogglePlay,
    onSeek,
    lyricLines,
    currentTime,
    durationMs,
  });

  useEffect(() => {
    stateRef.current = {
      onClose,
      onTogglePlay,
      onSeek,
      lyricLines,
      currentTime,
      durationMs,
    };
  });

  // Setup callbacks once on mount
  useEffect(() => {
    setOnClickControlThumb({ onEmit: () => stateRef.current.onClose() });
    setOnPlayOrResume({ onEmit: () => stateRef.current.onTogglePlay() });
    setOnSeekPosition({
      onEmit: (pos: number) => stateRef.current.onSeek(pos),
    });
    setOnLyricLineClick({
      onEmit: (evt) => {
        const targetTime =
          evt?.line?.getLine?.()?.startTime ??
          (typeof evt?.lineIndex === "number"
            ? stateRef.current.lyricLines[evt.lineIndex]?.startTime
            : undefined);
        if (typeof targetTime === "number") {
          stateRef.current.onSeek(targetTime);
        }
      },
    });
    setOnRequestPrevSong({ onEmit: () => stateRef.current.onSeek(0) });
  }, [
    setOnClickControlThumb,
    setOnPlayOrResume,
    setOnSeekPosition,
    setOnLyricLineClick,
    setOnRequestPrevSong,
  ]);

  // Sync track metadata and lyrics to AMLL atoms
  useEffect(() => {
    setMusicId(track.id || track.spotifyId || track.appleMusicId || "track");
    setMusicName(track.title || "Unknown Track");
    setMusicArtists(
      track.artists && track.artists.length > 0
        ? track.artists.map((name, i) => ({ name, id: `${i}` }))
        : [{ name: "Unknown Artist", id: "0" }],
    );
    setMusicAlbumName(track.album || "");
    setMusicCover(track.artworkUrl || "");
    setMusicCoverIsVideo(false);
    setMusicDuration(durationMs);
    setMusicLyricLines(lyricLines);
    setIsLyricPageOpened(true);

    return () => {
      setIsLyricPageOpened(false);
    };
  }, [
    track.id,
    track.spotifyId,
    track.appleMusicId,
    track.title,
    track.artists,
    track.album,
    track.artworkUrl,
    durationMs,
    lyricLines,
    setMusicId,
    setMusicName,
    setMusicArtists,
    setMusicAlbumName,
    setMusicCover,
    setMusicCoverIsVideo,
    setMusicDuration,
    setMusicLyricLines,
    setIsLyricPageOpened,
  ]);

  // Sync playback state
  useEffect(() => {
    setMusicPlaying(isPlaying);
  }, [isPlaying, setMusicPlaying]);

  // Sync playing position
  useEffect(() => {
    setMusicPlayingPosition(currentTime);
  }, [currentTime, setMusicPlayingPosition]);

  // Keyboard navigation shortcuts (attached once)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        stateRef.current.onClose();
      } else if (e.code === "Space") {
        e.preventDefault();
        stateRef.current.onTogglePlay();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        stateRef.current.onSeek(
          Math.max(0, stateRef.current.currentTime - 5000),
        );
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        stateRef.current.onSeek(
          Math.min(
            stateRef.current.durationMs,
            stateRef.current.currentTime + 5000,
          ),
        );
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex h-dvh w-screen flex-col overflow-hidden bg-black text-white select-none">
      <div className="relative h-full w-full">
        <PrebuiltLyricPlayer className="h-full w-full" />
      </div>
    </div>
  );
}
