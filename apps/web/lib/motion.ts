import type { Transition, Variants } from "motion/react";

/**
 * Shared motion language. Springs are critically damped (no wobble) so things
 * settle quickly, like iOS sheets and cards; "soft" is for large surfaces.
 */
export const spring = {
  // Buttons, pills, small UI
  snappy: { type: "spring", stiffness: 520, damping: 38, mass: 0.7 },
  // Cards, artwork, content blocks
  smooth: { type: "spring", stiffness: 260, damping: 30, mass: 0.9 },
  // Sheets, page-sized surfaces
  soft: { type: "spring", stiffness: 180, damping: 28, mass: 1 },
} satisfies Record<string, Transition>;

// Apple's "ease out" curve for opacity-only fades
export const easeOutExpo = [0.16, 1, 0.3, 1] as const;

export const fade: Transition = { duration: 0.5, ease: easeOutExpo };

/** Parent that reveals its children one after another */
export const stagger = (step = 0.06, delay = 0): Variants => ({
  hidden: {},
  show: { transition: { staggerChildren: step, delayChildren: delay } },
});

/** Child that rises into place while fading in */
export const rise: Variants = {
  hidden: { opacity: 0, y: 16, scale: 0.98 },
  show: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { ...spring.smooth, opacity: fade },
  },
};

/** Press feedback for anything clickable */
export const press = { scale: 0.96 } as const;
