"use client";

import { useEffect } from "react";
import {
  animate,
  motion,
  useMotionValue,
  useReducedMotion,
  useTransform,
} from "motion/react";
import { easeOutExpo } from "@/lib/motion";

const numberFormat = new Intl.NumberFormat("en-US");

interface CountUpProps {
  value: number;
  suffix?: string;
  delay?: number;
}

/** Rolls a number up from zero, like the counters in Apple's keynote slides */
export function CountUp({ value, suffix = "", delay = 0 }: CountUpProps) {
  const reduceMotion = useReducedMotion();
  const count = useMotionValue(0);
  const text = useTransform(
    count,
    (latest) => `${numberFormat.format(Math.round(latest))}${suffix}`,
  );

  useEffect(() => {
    if (reduceMotion) {
      count.set(value);
      return;
    }
    const controls = animate(count, value, {
      duration: 1.4,
      delay,
      ease: easeOutExpo,
    });
    return () => controls.stop();
  }, [count, value, delay, reduceMotion]);

  return <motion.span className="tabular-nums">{text}</motion.span>;
}
