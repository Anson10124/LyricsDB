"use client";

import { useSyncExternalStore } from "react";

// User-Agent Client Hints; only Chromium browsers have them, and the
// TypeScript DOM types don't list them yet
interface UserAgentData {
  brands: { brand: string; version: string }[];
  mobile: boolean;
  platform: string;
}

// Whether this browser can capture the sound the device itself is playing.
// Only desktop Chromium (Chrome, Edge and other Chromium browsers) returns
// audio from getDisplayMedia. Firefox and Safari share video only, and mobile
// browsers either lack getDisplayMedia or never include audio. Client Hints
// (navigator.userAgentData) exist only in Chromium, so their absence already
// rules out Firefox, Safari and every browser on iOS.
function canCaptureDeviceAudio(): boolean {
  if (typeof navigator === "undefined") return false;
  if (typeof navigator.mediaDevices?.getDisplayMedia !== "function") return false;
  const ua = (navigator as Navigator & { userAgentData?: UserAgentData }).userAgentData;
  if (!ua) return false;
  const chromium = ua.brands.some((b) => b.brand === "Chromium");
  // Android tablets report mobile: false, so check the platform too
  return chromium && !ua.mobile && ua.platform !== "Android";
}

const subscribe = () => () => {};

// False during server rendering and the first client render, so the page
// hydrates the same way everywhere; then the real answer
export function useDeviceAudioSupport(): boolean {
  return useSyncExternalStore(subscribe, canCaptureDeviceAudio, () => false);
}
