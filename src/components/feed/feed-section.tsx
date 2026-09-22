"use client";

import React from "react";
import type { FeedSection } from "../../lib/feed/sections";
import type { FeedGroup } from "../../lib/feed/grouping";

/**
 * One titled block of the feed.
 *
 * The heading carries the count, and an untitled section renders as a plain
 * list: a lone "Everything else" heading would be noise when there is nothing
 * for it to be everything else *than*.
 */
export function FeedSectionBlock({
  section,
  renderGroup,
  footer,
}: {
  section: FeedSection;
  renderGroup: (group: FeedGroup) => React.ReactNode;
  /** The scroll sentinel, when the section is the one that keeps growing. */
  footer?: React.ReactNode;
}) {
  return (
    <section className="space-y-2">
      {section.title && (
        <div className="flex items-baseline gap-2">
          <h2 className="text-[13px] font-medium text-foreground">{section.title}</h2>
          <span className="text-[11px] tabular-nums text-muted-foreground">{section.groups.length}</span>
        </div>
      )}
      {section.groups.map(renderGroup)}
      {footer}
    </section>
  );
}
