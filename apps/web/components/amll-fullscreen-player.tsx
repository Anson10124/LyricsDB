"use client";

import { useEffect, useRef } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import type { SanitizedTrack, TrackRecord } from "@repo/types";
import type { LyricLine } from "@applemusic-like-lyrics/core";
import { formatArtworkUrl } from "@/lib/artwork";
import { uniqueArtists } from "@/lib/utils";
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
import { installMediaPlayGuard } from "@/lib/media-play-guard";

installMediaPlayGuard();

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

  const animatedVideo =
    track.artwork?.squareVideoUrl || track.artwork?.tallVideoUrl;
  const coverIsVideo = Boolean(animatedVideo);
  const coverUrl = animatedVideo || formatArtworkUrl(track.artwork, 1000) || "";

  // AMLL keeps its state in global atoms, so on open they still hold the
  // previous song's cover. Its background loads covers without cancelling
  // older loads, so a slow old cover could land last and stay on screen.
  // The player is therefore only shown once the atoms hold this song's cover.
  const currentCover = useAtomValue(musicCoverAtom);
  const coverReady = currentCover === coverUrl;

  useEffect(() => {
    setMusicCover(coverUrl);
    setMusicCoverIsVideo(coverIsVideo);
  }, [coverUrl, coverIsVideo, setMusicCover, setMusicCoverIsVideo]);

  // Clear the cover on close so the next song never starts from this one
  useEffect(
    () => () => {
      setMusicCover("");
      setMusicCoverIsVideo(false);
    },
    [setMusicCover, setMusicCoverIsVideo],
  );

  // Sync track metadata and lyrics to AMLL atoms
  useEffect(() => {
    setMusicId(track.id || track.spotifyId || track.appleMusicId || "track");
    setMusicName(track.title || "Unknown Track");
    // AMLL keys each artist by name, so repeated names must be removed
    const artists = uniqueArtists(track.artists);
    setMusicArtists(
      artists.length > 0
        ? artists.map((name, i) => ({ name, id: `${i}` }))
        : [{ name: "Unknown Artist", id: "0" }],
    );
    setMusicAlbumName(track.album || "");
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
    durationMs,
    lyricLines,
    setMusicId,
    setMusicName,
    setMusicArtists,
    setMusicAlbumName,
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
        {coverReady && <PrebuiltLyricPlayer className="h-full w-full" />}
      </div>
    </div>
  );
}
