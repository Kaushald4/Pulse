"use client";

import React from "react";
import { cn } from "../lib/utils";

export function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/**
 * Favicon for an external link.
 *
 * The renderer cannot read another site's HTML (CORS), so an og:image preview
 * is not available here — a favicon service gives us a recognisable mark
 * without a backend round trip. It self-hides if the lookup fails so a missing
 * icon never leaves a broken image in the layout.
 */
function faviconUrl(host: string): string {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`;
}

export function Favicon({ url, className }: { url: string; className?: string }) {
  const host = hostnameOf(url);
  const [failed, setFailed] = React.useState(false);

  React.useEffect(() => setFailed(false), [host]);

  if (!host || failed) return null;

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={faviconUrl(host)}
      alt=""
      width={14}
      height={14}
      loading="lazy"
      onError={() => setFailed(true)}
      className={cn("size-3.5 shrink-0 rounded-[3px]", className)}
    />
  );
}

export function HostLabel({ url, className }: { url: string; className?: string }) {
  const host = hostnameOf(url);
  if (!host) return null;
  return <span className={cn("truncate text-[11px] text-muted-foreground", className)}>{host}</span>;
}

/**
 * Fallback banner for a link with no usable Open Graph image: the app's own
 * mark on a quiet tinted panel, so every card leads with artwork instead of a
 * bare strip of text.
 */
export function MascotBanner({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "relative flex aspect-video w-full items-center justify-center overflow-hidden bg-secondary",
        className
      )}
    >
      <div
        aria-hidden
        className="absolute inset-0 opacity-[0.06]"
        style={{ backgroundImage: "radial-gradient(circle at 50% 45%, currentColor 0%, transparent 65%)" }}
      />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/app-icon.png" alt="" className="relative size-12 rounded-xl" />
    </div>
  );
}

/**
 * Full-width Open Graph banner, the preview journal's resource cards lead with.
 * With `fallback`, a dead link or a page with no og:image gets the mascot banner
 * rather than an empty top; otherwise it hides itself (no broken-image icon).
 */
export function LinkImage({
  src,
  className,
  fallback = false,
}: {
  src?: string | null;
  className?: string;
  fallback?: boolean;
}) {
  const [failed, setFailed] = React.useState(false);
  React.useEffect(() => setFailed(false), [src]);

  if (!src || failed) return fallback ? <MascotBanner className={className} /> : null;

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      loading="lazy"
      onError={() => setFailed(true)}
      className={cn("aspect-video w-full object-cover", className)}
    />
  );
}

/** Compact preview for dense list rows. */
export function LinkThumb({ src, className }: { src?: string | null; className?: string }) {
  const [failed, setFailed] = React.useState(false);
  React.useEffect(() => setFailed(false), [src]);
  if (!src || failed) return null;

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      loading="lazy"
      onError={() => setFailed(true)}
      className={cn("h-16 w-24 shrink-0 rounded-md border border-border object-cover", className)}
    />
  );
}
