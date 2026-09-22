"use client";

import React from "react";

/** How many rows each step of the window reveals. */
const PAGE_SIZE = 30;

/**
 * A window onto a long list, widened as the sentinel scrolls into view.
 *
 * Returns how many rows to render, whether any are left, and a ref to place on the
 * sentinel element.
 *
 * The observer is attached through a callback ref, so its lifetime is exactly the
 * lifetime of the sentinel. That is the whole point, and it is what was wrong
 * before. The sentinel is rendered conditionally, so it can leave the document and
 * come back while the length of the underlying list has not changed. An effect
 * keyed on that length then has no reason to run again, so the new element is
 * never observed, and the list sits on "Loading more..." for good while the only
 * observer in existence watches a node that is no longer in the document. Binding
 * to the node removes the possibility rather than trying to work around it.
 */
export function useProgressiveList(total: number, options: { resetKey?: unknown; pageSize?: number } = {}) {
  const { resetKey, pageSize = PAGE_SIZE } = options;
  const [visibleCount, setVisibleCount] = React.useState(pageSize);
  const observer = React.useRef<IntersectionObserver | null>(null);

  // A different list, such as another filter, starts from the top again.
  React.useEffect(() => {
    setVisibleCount(pageSize);
  }, [resetKey, pageSize]);

  const sentinelRef = React.useCallback(
    (node: HTMLDivElement | null) => {
      // Called with null when the sentinel is removed, which disconnects it.
      observer.current?.disconnect();
      observer.current = null;
      if (!node) return;

      const created = new IntersectionObserver(
        (entries) => {
          if (entries[0]?.isIntersecting) {
            setVisibleCount((shown) => shown + pageSize);
          }
        },
        // Lead the scroll slightly, so it does not visibly stall at the bottom.
        { threshold: 0.1, rootMargin: "200px" }
      );

      created.observe(node);
      observer.current = created;
    },
    [pageSize]
  );

  return {
    /** Render the list as `list.slice(0, visibleCount)`. */
    visibleCount,
    /** Whether the window is still smaller than the list. */
    hasMore: visibleCount < total,
    sentinelRef,
  };
}
