/**
 * AMLL calls `video.play()` without handling its promise. When a cover video
 * is removed (switching songs, closing fullscreen) before playback starts, the
 * browser rejects that promise with an AbortError, which surfaces as an
 * "Unhandled Runtime Error" even though nothing is wrong.
 *
 * This wraps `play()` once so that AbortError alone resolves quietly. Every
 * other rejection (e.g. autoplay blocked) still reaches the caller unchanged.
 */
let installed = false;

export function installMediaPlayGuard() {
  if (installed || typeof window === "undefined") return;
  installed = true;

  const play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
    return play.call(this).catch((error: unknown) => {
      if (error instanceof DOMException && error.name === "AbortError") return;
      throw error;
    });
  };
}
