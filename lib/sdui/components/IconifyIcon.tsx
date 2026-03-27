'use client';

/**
 * IconifyIcon — renders any Iconify icon using the api.iconify.design CDN.
 *
 * Usage in SDUI JSON:
 * { "type": "IconifyIcon", "props": { "icon": "heroicons:star", "size": 24, "color": "#facc15" } }
 *
 * The `icon` prop uses the format "<set>:<name>", e.g.:
 *   "heroicons:heart", "mdi:check-circle", "tabler:coffee", "carbon:arrow-right"
 *
 * Color can be passed as hex string or a CSS variable reference like
 * `var(--theme-primary, currentColor)`. CSS variable colors are re-resolved
 * automatically when the variable changes (e.g. theme switch in the builder).
 */

import React, { useState, useEffect } from 'react';

interface IconifyIconProps {
  icon: string;
  size?: number | string;
  color?: string;
  className?: string;
  style?: React.CSSProperties;
  [key: string]: unknown;
}

/** Resolve a CSS variable reference to a hex string.
 *  Supports both `var(--name)` and `var(--name, fallback)` syntax.
 *  Theme vars may be stored as "R G B" triplets on :root, e.g. `--primary: 30 41 59`,
 *  or as hex strings, e.g. `--theme-primary: #c026d3`. */
function resolveCssVar(color: string): string {
  if (typeof document === 'undefined') return color;
  // Match both var(--name) and var(--name, fallback)
  const match = color.match(/var\(--([\w-]+)/);
  if (!match) return color;
  const val = getComputedStyle(document.documentElement).getPropertyValue(`--${match[1]}`).trim();
  if (val) {
    // "R G B" triplet → hex
    const parts = val.split(/\s+/).map(Number);
    if (parts.length === 3 && parts.every(n => !isNaN(n))) {
      return `#${parts.map(n => n.toString(16).padStart(2, '0')).join('')}`;
    }
    return val; // already a valid CSS value (hex, rgb(), etc.)
  }
  // CSS var not set — extract the fallback value from var(--name, fallback)
  const fallbackMatch = color.match(/var\(--[\w-]+,\s*(.+)\)$/);
  return fallbackMatch ? fallbackMatch[1].trim() : color;
}

/**
 * Reactively resolves a color string that may contain a CSS variable reference.
 * Subscribes to style attribute changes on document.documentElement so the
 * component re-renders whenever the theme updates CSS variables (e.g. in the builder).
 */
function useResolvedColor(color: string | undefined): string {
  const resolve = () => {
    if (!color || color === 'currentColor') return 'currentColor';
    return resolveCssVar(color);
  };
  const [resolved, setResolved] = useState(resolve);

  useEffect(() => {
    setResolved(resolve());
    // Only subscribe to CSS variable changes when the color is a variable reference
    if (!color?.includes('var(')) return;

    const update = () => setResolved(resolveCssVar(color));

    // Primary signal: builder dispatches this event after updating its managed
    // <style> tag textContent (the MutationObserver on :root.style won't fire
    // because the builder injects vars via a stylesheet, not element.style).
    window.addEventListener('builder:css-vars-updated', update);

    // Fallback: some contexts (non-builder) do set vars via element.style.setProperty
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });

    return () => {
      window.removeEventListener('builder:css-vars-updated', update);
      observer.disconnect();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [color]);

  return resolved;
}

export default function IconifyIcon({ icon, size = 24, color, className, style, ...rest }: IconifyIconProps) {
  // Resolve CSS variables reactively — updates when the theme changes CSS vars on :root
  const resolvedColor = useResolvedColor(color);

  if (!icon || typeof icon !== 'string') return null;

  const numSize = typeof size === 'string' ? parseInt(size, 10) || 24 : size;

  // Build Iconify CDN URL: https://api.iconify.design/{set}/{name}.svg?color=...
  const [set, name] = icon.includes(':') ? icon.split(':') : ['lucide', icon];
  if (!set || !name) return null;

  const encodedColor = (resolvedColor && resolvedColor !== 'currentColor')
    ? encodeURIComponent(resolvedColor)
    : 'currentColor';
  const src = `https://api.iconify.design/${set}/${name}.svg?color=${encodedColor}`;

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={name}
      width={numSize}
      height={numSize}
      className={className}
      style={{ display: 'inline-block', verticalAlign: 'middle', ...style }}
      {...(rest as React.ImgHTMLAttributes<HTMLImageElement>)}
    />
  );
}
