"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion, useMotionValueEvent, useScroll } from "motion/react";
import { cn } from "@/lib/utils";
import { press, spring } from "@/lib/motion";

const NAV_LINKS = [
  { href: "/stats", label: "Stats" },
  { href: "/docs", label: "Docs" },
];

interface SiteHeaderProps {
  // "overlay" sits on top of artwork and always uses light text
  tone?: "default" | "overlay";
}

export function SiteHeader({ tone = "default" }: SiteHeaderProps) {
  const pathname = usePathname();
  const { scrollY } = useScroll();
  const [scrolled, setScrolled] = useState(false);

  useMotionValueEvent(scrollY, "change", (y) => setScrolled(y > 8));

  const overlay = tone === "overlay";

  return (
    <header
      className="fixed inset-x-0 top-0 z-40 flex justify-center px-3 pt-3"
    >
      <div
        className={cn(
          "flex w-full max-w-6xl items-center justify-between rounded-2xl px-3 py-2 transition-[background-color,box-shadow,backdrop-filter] duration-500",
          scrolled &&
            (overlay
              ? "bg-black/25 shadow-lg shadow-black/10 backdrop-blur-xl"
              : "bg-background/70 shadow-sm ring-1 ring-border/60 backdrop-blur-xl"),
        )}
      >
        <motion.div whileTap={press} transition={spring.snappy}>
          <Link
            href="/"
            className={cn(
              "rounded-lg px-1.5 py-0.5 text-lg font-extrabold tracking-tight",
              overlay ? "text-white" : "text-foreground",
            )}
          >
            Lyrics<span className="text-primary">DB</span>
          </Link>
        </motion.div>

        <nav className="flex items-center gap-1">
          {NAV_LINKS.map((link) => {
            const active = pathname.startsWith(link.href);
            return (
              <motion.div
                key={link.href}
                whileTap={press}
                transition={spring.snappy}
                className="relative"
              >
                {active && (
                  <motion.span
                    layoutId="site-header-active"
                    transition={spring.snappy}
                    className={cn(
                      "absolute inset-0 rounded-full",
                      overlay ? "bg-white/15" : "bg-muted",
                    )}
                  />
                )}
                <Link
                  href={link.href}
                  className={cn(
                    "relative block rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors",
                    overlay
                      ? "text-white/70 hover:text-white"
                      : "text-muted-foreground hover:text-foreground",
                    active && (overlay ? "text-white" : "text-foreground"),
                  )}
                >
                  {link.label}
                </Link>
              </motion.div>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
