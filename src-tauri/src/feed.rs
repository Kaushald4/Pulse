use regex::Regex;
use serde::Serialize;
use std::time::Duration;

use crate::metadata::decode_entities;

/// A feed is small, but a misconfigured URL could still return something large.
const MAX_BYTES: usize = 4 * 1024 * 1024;
const TIMEOUT_SECS: u64 = 15;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FeedItem {
    /// Stable per-entry id (RSS `guid` / Atom `id`), falling back to the link.
    pub id: String,
    pub title: String,
    pub url: String,
    pub summary: Option<String>,
    pub author: Option<String>,
    /// Raw date string (RFC 2822 or RFC 3339); the renderer parses it.
    pub published_at: Option<String>,
}

/// Unwraps `<![CDATA[ … ]]>` when a value is wrapped in it.
fn strip_cdata(value: &str) -> &str {
    let trimmed = value.trim();
    if let Some(inner) = trimmed.strip_prefix("<![CDATA[") {
        if let Some(end) = inner.rfind("]]>") {
            return &inner[..end];
        }
    }
    trimmed
}

fn strip_html(text: &str) -> String {
    let re = Regex::new(r"(?is)<[^>]+>").unwrap();
    re.replace_all(text, " ").split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Collapses a raw element body into plain text: CDATA unwrapped, entities
/// decoded, markup stripped, whitespace collapsed.
fn clean_text(raw: &str) -> String {
    let without_cdata = strip_cdata(raw);
    let decoded = decode_entities(without_cdata);
    strip_html(&decoded)
}

/// First non-empty `<name>…</name>` in `block`, tolerating attributes.
fn tag_text(block: &str, names: &[&str]) -> Option<String> {
    for name in names {
        let pattern = format!(r"(?is)<{name}(?:\s[^>]*)?>(.*?)</{name}>");
        let Ok(re) = Regex::new(&pattern) else { continue };
        if let Some(captures) = re.captures(block) {
            let text = clean_text(captures.get(1).map(|m| m.as_str()).unwrap_or(""));
            if !text.is_empty() {
                return Some(text);
            }
        }
    }
    None
}

fn attr(attrs: &str, key: &str) -> Option<String> {
    let re = Regex::new(&format!(r#"(?is)\b{key}\s*=\s*["']([^"']*)["']"#)).ok()?;
    re.captures(attrs)
        .and_then(|captures| captures.get(1))
        .map(|m| m.as_str().trim().to_string())
        .filter(|value| !value.is_empty())
}

/// Atom's `<link>` is self-closing and may repeat (alternate/self/…); prefer
/// `rel="alternate"` (the human-readable page), falling back to the first href.
fn atom_link(block: &str) -> Option<String> {
    let re = Regex::new(r"(?is)<link\b([^>]*)>").ok()?;
    let mut fallback = None;
    for captures in re.captures_iter(block) {
        let attrs = captures.get(1).map(|m| m.as_str()).unwrap_or("");
        let Some(href) = attr(attrs, "href") else { continue };
        let rel = attr(attrs, "rel");
        if rel.as_deref().map(|value| value == "alternate").unwrap_or(true) {
            return Some(href);
        }
        if fallback.is_none() {
            fallback = Some(href);
        }
    }
    fallback
}

fn blocks(xml: &str, tag: &str) -> Vec<String> {
    let pattern = format!(r"(?is)<{tag}(?:\s[^>]*)?>(.*?)</{tag}>");
    let Ok(re) = Regex::new(&pattern) else { return Vec::new() };
    re.captures_iter(xml)
        .map(|captures| {
            captures
                .get(1)
                .map(|m| m.as_str())
                .unwrap_or_default()
                .to_string()
        })
        .collect()
}

/// Normalizes RSS 2.0 (`<item>`) and Atom (`<entry>`) into one shape — both
/// dialects appear across the default feeds.
pub fn parse_feed(xml: &str) -> Vec<FeedItem> {
    let rss = blocks(xml, "item");
    if !rss.is_empty() {
        return rss
            .iter()
            .filter_map(|block| {
                let title = tag_text(block, &["title"]).unwrap_or_default();
                let link = tag_text(block, &["link"]).unwrap_or_default();
                if title.is_empty() || link.is_empty() {
                    return None;
                }
                let guid = tag_text(block, &["guid"]).unwrap_or_else(|| link.clone());
                Some(FeedItem {
                    id: guid,
                    title,
                    url: link,
                    summary: tag_text(block, &["description"]),
                    author: tag_text(block, &["dc:creator", "author"]),
                    published_at: tag_text(block, &["pubDate"]),
                })
            })
            .collect();
    }

    blocks(xml, "entry")
        .iter()
        .filter_map(|block| {
            let title = tag_text(block, &["title"]).unwrap_or_default();
            let id = tag_text(block, &["id"]).unwrap_or_default();
            let link = atom_link(block);
            let url = link.clone().unwrap_or_else(|| id.clone());
            if title.is_empty() || url.is_empty() {
                return None;
            }
            Some(FeedItem {
                id: if id.is_empty() { url.clone() } else { id },
                title,
                url,
                summary: tag_text(block, &["summary", "content"]),
                author: tag_text(block, &["name"]),
                published_at: tag_text(block, &["published", "updated"]),
            })
        })
        .collect()
}

/// Fetches and parses a single RSS/Atom feed.
///
/// Runs in Rust because reading another origin is blocked by CORS in the webview,
/// same reasoning as `fetch_link_metadata`.
#[tauri::command]
pub async fn fetch_feed(url: String, limit: Option<u32>) -> Result<Vec<FeedItem>, String> {
    let parsed = match url::Url::parse(&url) {
        Ok(parsed) if parsed.scheme() == "http" || parsed.scheme() == "https" => parsed,
        Ok(_) => return Err("Feed URL must start with http:// or https://.".to_string()),
        Err(e) => return Err(format!("Invalid feed URL: {e}")),
    };
    if let Some(host) = parsed.host_str() {
        if host == "localhost" || host == "127.0.0.1" || host == "::1" || host.ends_with(".local") {
            return Err("Refusing to fetch a local address.".to_string());
        }
    }

    let client = reqwest::Client::builder()
        .user_agent(
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 \
             (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
        )
        .timeout(Duration::from_secs(TIMEOUT_SECS))
        .redirect(reqwest::redirect::Policy::limited(5))
        .build()
        .map_err(|e| format!("Could not build HTTP client: {e}"))?;

    let response = client
        .get(parsed)
        .send()
        .await
        .map_err(|e| format!("Feed request failed: {e}"))?;

    if !response.status().is_success() {
        return Err(format!("Feed returned HTTP {}", response.status()));
    }

    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("Could not read feed body: {e}"))?;
    let xml = String::from_utf8_lossy(&bytes[..bytes.len().min(MAX_BYTES)]).to_string();

    let mut items = parse_feed(&xml);
    if let Some(limit) = limit {
        items.truncate(limit as usize);
    }
    Ok(items)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_rss_with_cdata_and_numeric_entities() {
        let xml = r#"<rss><channel>
            <item>
                <title><![CDATA[Rust &#8217;s roadmap]]></title>
                <link>https://example.com/a</link>
                <guid>tag:example.com,2025:a</guid>
                <pubDate>Tue, 03 Jun 2025 10:00:00 GMT</pubDate>
                <description><![CDATA[<p>Hello &amp; welcome</p>]]></description>
                <dc:creator>Jane</dc:creator>
            </item>
        </channel></rss>"#;
        let items = parse_feed(xml);
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].title, "Rust \u{2019}s roadmap");
        assert_eq!(items[0].url, "https://example.com/a");
        assert_eq!(items[0].id, "tag:example.com,2025:a");
        assert_eq!(items[0].summary.as_deref(), Some("Hello & welcome"));
        assert_eq!(items[0].author.as_deref(), Some("Jane"));
    }

    #[test]
    fn parses_atom_and_prefers_alternate_link() {
        let xml = r#"<feed>
            <entry>
                <title>The Verge story</title>
                <link rel="self" href="https://www.theverge.com/feed/123"/>
                <link rel="alternate" href="https://www.theverge.com/2025/1/1/123/story"/>
                <id>urn:theverge:123</id>
                <updated>2025-01-01T12:00:00Z</updated>
                <summary>&lt;p&gt;A summary&lt;/p&gt;</summary>
                <author><name>Nilay</name></author>
            </entry>
        </feed>"#;
        let items = parse_feed(xml);
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].url, "https://www.theverge.com/2025/1/1/123/story");
        assert_eq!(items[0].id, "urn:theverge:123");
        assert_eq!(items[0].summary.as_deref(), Some("A summary"));
        assert_eq!(items[0].author.as_deref(), Some("Nilay"));
    }

    #[test]
    fn falls_back_to_link_when_guid_is_absent() {
        let xml = r#"<rss><channel><item>
            <title>No guid</title><link>https://example.com/b</link>
        </item></channel></rss>"#;
        let items = parse_feed(xml);
        assert_eq!(items[0].id, "https://example.com/b");
    }

    #[test]
    fn returns_empty_for_unrecognized_documents() {
        assert!(parse_feed("<html><body>not a feed</body></html>").is_empty());
    }
}
