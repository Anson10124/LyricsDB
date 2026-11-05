"use client";

import { MotionConfig } from "motion/react";

// Honors the OS "reduce motion" setting: transforms are skipped, fades remain
export function MotionProvider({ children }: { children: React.ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
