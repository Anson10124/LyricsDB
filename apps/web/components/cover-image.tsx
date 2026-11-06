import Image, { getImageProps, type ImageProps } from "next/image";
import { isOptimizableImage } from "@/lib/image-hosts";

type CoverImageProps = Omit<ImageProps, "src" | "fill" | "unoptimized"> & {
  src: string;
};

/**
 * Album art that fills its (positioned, sized) parent. Goes through the
 * Next.js image optimizer when the host is allowed, and is shown as-is
 * otherwise so a cover from an unexpected host still appears.
 */
export function CoverImage({ src, className, ...props }: CoverImageProps) {
  return (
    <Image
      src={src}
      fill
      unoptimized={!isOptimizableImage(src)}
      className={className ?? "object-cover"}
      {...props}
    />
  );
}

/**
 * A single optimized URL for a cover shown at up to `width` CSS pixels (sized
 * for 2x screens), for places that need a plain URL rather than <Image>.
 */
export function optimizedCoverUrl(src: string, width: number): string {
  return getImageProps({
    src,
    alt: "",
    width,
    height: width,
    unoptimized: !isOptimizableImage(src),
  }).props.src;
}
