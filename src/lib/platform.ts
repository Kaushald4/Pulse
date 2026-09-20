"use client";

import * as React from "react";

/** True on macOS/iOS, where the modifier key is ⌘ rather than Ctrl. */
export function isMac(): boolean {
  if (typeof navigator === "undefined") return false;
  const platform = navigator.platform ?? "";
  if (platform) return /mac|iphone|ipad|ipod/i.test(platform);
  return /mac os x/i.test(navigator.userAgent);
}

/**
 * The platform's modifier-key label, resolved after mount.
 *
 * Static export prerenders without a `navigator`, so the first paint uses the
 * non-mac value and the effect corrects it - consumers should mark the label
 * with `suppressHydrationWarning`.
 */
export function useModKey(): string {
  const [label, setLabel] = React.useState("Ctrl");
  React.useEffect(() => setLabel(isMac() ? "⌘" : "Ctrl"), []);
  return label;
}
