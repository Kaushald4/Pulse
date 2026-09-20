/**
 * The option editor for a source, dispatched by source kind. Each source's
 * fields live in their own file so a new source is a new file, not another
 * branch in a growing switch.
 */
import type { OptionFieldProps } from "./shared";
import { HackerNewsFields } from "./hackernews-fields";
import { RssFields } from "./rss-fields";
import { RedditFields } from "./reddit-fields";
import { TwitterFields } from "./twitter-fields";
import { LinkedInFields } from "./linkedin-fields";
import { ArxivFields } from "./arxiv-fields";
import { DevToFields } from "./devto-fields";
import { LobstersFields } from "./lobsters-fields";
import { GithubFields } from "./github-fields";
import { FallbackFields } from "./fallback-fields";

export function OptionFields(props: OptionFieldProps) {
  switch (props.source.source) {
    case "hackernews":
      return <HackerNewsFields {...props} />;
    case "rss":
      return <RssFields {...props} />;
    case "reddit":
      return <RedditFields {...props} />;
    case "twitter":
      return <TwitterFields {...props} />;
    case "linkedin":
      return <LinkedInFields {...props} />;
    case "arxiv":
      return <ArxivFields {...props} />;
    case "devto":
      return <DevToFields {...props} />;
    case "lobsters":
      return <LobstersFields {...props} />;
    case "github":
      return <GithubFields {...props} />;
    default:
      return <FallbackFields {...props} />;
  }
}
