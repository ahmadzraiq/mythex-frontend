"use client";

import React, { useCallback, useEffect, useRef } from 'react';
import useEmblaCarousel from "embla-carousel-react";
const ChevronLeft = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
);
const ChevronRight = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
);

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

  // Reinitialize Embla when slide count changes (e.g. after data loads dynamically).
  // Uses containerNode() since emblaRef is a callback ref, not a RefObject.
  const slideCountRef = useRef(0);
  useEffect(() => {
    if (!emblaApi) return;
    const count = emblaApi.containerNode().childElementCount;
    if (count !== slideCountRef.current) {
      slideCountRef.current = count;
      emblaApi.reInit();
    }
  });

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
