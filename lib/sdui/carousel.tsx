"use client";

import React, { useCallback } from "react";
import useEmblaCarousel from "embla-carousel-react";
import { ChevronLeft, ChevronRight } from "lucide-react-native";

// ─── CarouselSlide ───────────────────────────────────────────────────────────
// Thin slide wrapper. Use with map in JSON config to render one slide per item.
// Props forwarded from JSON: className (responsive basis + padding)

interface CarouselSlideProps {
  className?: string;
  children?: React.ReactNode;
}

export function CarouselSlide({ className, children }: CarouselSlideProps) {
  return (
    <div className={`pl-2 md:pl-4 flex-none ${className ?? ""}`}>
      {children}
    </div>
  );
}

// ─── Carousel ────────────────────────────────────────────────────────────────
// Generic embla carousel. Content comes from JSON children (CarouselSlide nodes).
// Props forwarded from JSON: loop, align, showArrows, className

interface CarouselProps {
  loop?: boolean;
  align?: "start" | "center" | "end";
  showArrows?: boolean;
  className?: string;
  children?: React.ReactNode;
}

export function Carousel({
  loop = true,
  align = "start",
  showArrows = true,
  className,
  children,
}: CarouselProps) {
  const [emblaRef, emblaApi] = useEmblaCarousel({ align, loop });
  const scrollPrev = useCallback(() => emblaApi?.scrollPrev(), [emblaApi]);
  const scrollNext = useCallback(() => emblaApi?.scrollNext(), [emblaApi]);

  return (
    <div className={`relative ${className ?? ""}`}>
      <div className="overflow-hidden" ref={emblaRef}>
        <div className="flex -ml-2 md:-ml-4">{children}</div>
      </div>

      {showArrows && (
        <>
          <button
            onClick={scrollPrev}
            className="hidden md:inline-flex absolute top-1/2 -left-12 -translate-y-1/2 h-8 w-8 items-center justify-center rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-sm hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50"
            aria-label="Previous slide"
          >
            <ChevronLeft size={16} />
          </button>
          <button
            onClick={scrollNext}
            className="hidden md:inline-flex absolute top-1/2 -right-12 -translate-y-1/2 h-8 w-8 items-center justify-center rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-sm hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50"
            aria-label="Next slide"
          >
            <ChevronRight size={16} />
          </button>
        </>
      )}
    </div>
  );
}
