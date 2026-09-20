use regex::Regex;
use serde::Serialize;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::Semaphore;

/// Don't pull down whole pages — we only need the document head.
const MAX_BYTES: usize = 512 * 1024;
const TIMEOUT_SECS: u64 = 10;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkMetadata {
    pub url: String,
    pub title: Option<String>,
    pub description: Option<String>,
    pub image: Option<String>,
    pub site_name: Option<String>,
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

fn failure(url: String, message: String) -> LinkMetadata {
    LinkMetadata {
        url,
        title: None,
        description: None,
        image: None,
        site_name: None,
        ok: false,
        error: Some(message),
    }
}

/// Decodes the named entities we care about, then numeric character references
/// (`&#8217;`, `&#x2019;`) — real pages and feeds use smart quotes and ellipses
/// this way, and leaving them raw leaks "&#8217;" into descriptions.
pub(crate) fn decode_entities(value: &str) -> String {
    let named = value
        .replace("&amp;", "&")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&apos;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&nbsp;", " ");

    let Ok(re) = Regex::new(r"&#(x?)([0-9a-fA-F]+);") else {
        return named;
    };
    re.replace_all(&named, |captures: &regex::Captures| {
        let radix = if captures.get(1).map(|m| m.as_str()).unwrap_or("").is_empty() {
            10
        } else {
            16
        };
        captures
            .get(2)
            .and_then(|m| u32::from_str_radix(m.as_str(), radix).ok())
            .and_then(char::from_u32)
            .map(|c| c.to_string())
            .unwrap_or_default()
    })
    .to_string()
}

/// Pulls a `<meta>` value, trying `property` first then `name` (Open Graph vs
/// Twitter/plain HTML). Attribute order varies between sites, so both orders
/// are attempted.
fn meta_content(html: &str, keys: &[&str]) -> Option<String> {
    for key in keys {
        let patterns = [
            format!(
                r#"(?is)<meta[^>]+(?:property|name)=["']{key}["'][^>]*?content=["']([^"']*)["']"#
            ),
            format!(
                r#"(?is)<meta[^>]+content=["']([^"']*)["'][^>]*?(?:property|name)=["']{key}["']"#
            ),
        ];
        for pattern in patterns {
            if let Ok(re) = Regex::new(&pattern) {
                if let Some(captures) = re.captures(html) {
                    if let Some(found) = captures.get(1) {
                        let value = decode_entities(found.as_str().trim());
                        if !value.is_empty() {
                            return Some(value);
                        }
                    }
                }
            }
        }
    }
    None
}

pub fn document_title(html: &str) -> Option<String> {
    let re = Regex::new(r"(?is)<title[^>]*>([\s\S]*?)</title>").ok()?;
    let raw = re.captures(html)?.get(1)?.as_str().trim().to_string();
    let collapsed = raw.split_whitespace().collect::<Vec<_>>().join(" ");
    if collapsed.is_empty() {
        None
    } else {
        Some(decode_entities(&collapsed))
    }
}

/// Every `href` on the page, de-duplicated and absolutised against `base` when
/// given. Feed this through `classifyUrl` before trusting any of it.
pub fn extract_hrefs(html: &str) -> Vec<String> {
    let Ok(re) = Regex::new(r#"(?is)href=["']([^"']+)["']"#) else {
        return Vec::new();
    };

    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();

    for captures in re.captures_iter(html) {
        let raw = decode_entities(captures.get(1).map(|m| m.as_str()).unwrap_or("").trim());
        if raw.is_empty()
            || raw.starts_with('#')
            || raw.starts_with("javascript:")
            || raw.starts_with("mailto:")
            || raw.starts_with("data:")
        {
            continue;
        }
        if (raw.starts_with("http://") || raw.starts_with("https://")) && seen.insert(raw.clone()) {
            out.push(raw);
        }
        if out.len() >= 400 {
            break;
        }
    }

    out
}

/// Resolves a possibly-relative og:image against the page URL.
fn absolute_url(base: &str, candidate: &str) -> Option<String> {
    if candidate.starts_with("http://") || candidate.starts_with("https://") {
        return Some(candidate.to_string());
    }
    let base = url::Url::parse(base).ok()?;
    base.join(candidate).ok().map(|joined| joined.to_string())
}

async fn fetch_one(client: &reqwest::Client, url: String) -> LinkMetadata {
    // Only http(s) — never read local files or hit loopback on a page's behalf.
    let parsed = match url::Url::parse(&url) {
        Ok(parsed) if parsed.scheme() == "http" || parsed.scheme() == "https" => parsed,
        Ok(_) => return failure(url, "unsupported scheme".to_string()),
        Err(e) => return failure(url, format!("invalid url: {e}")),
    };
    if let Some(host) = parsed.host_str() {
        if host == "localhost" || host == "127.0.0.1" || host == "::1" || host.ends_with(".local") {
            return failure(url, "refusing to fetch a local address".to_string());
        }
    }

    let response = match client.get(parsed.clone()).send().await {
        Ok(response) => response,
        Err(e) => return failure(url, format!("request failed: {e}")),
    };

    if !response.status().is_success() {
        return failure(url, format!("HTTP {}", response.status()));
    }

    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("");
    if !content_type.contains("html") {
        return LinkMetadata {
            url,
            title: None,
            description: None,
            image: None,
            site_name: None,
            ok: true,
            error: None,
        };
    }

    let bytes = match response.bytes().await {
        Ok(bytes) => bytes,
        Err(e) => return failure(url, format!("could not read body: {e}")),
    };
    let html = String::from_utf8_lossy(&bytes[..bytes.len().min(MAX_BYTES)]).to_string();

    let image = meta_content(&html, &["og:image:secure_url", "og:image", "twitter:image"])
        .and_then(|candidate| absolute_url(parsed.as_str(), &candidate));

    LinkMetadata {
        url,
        title: meta_content(&html, &["og:title", "twitter:title"]).or_else(|| document_title(&html)),
        description: meta_content(&html, &["og:description", "twitter:description", "description"]),
        image,
        site_name: meta_content(&html, &["og:site_name"]),
        ok: true,
        error: None,
    }
}

/// Fetches Open Graph metadata for a batch of links with bounded concurrency.
///
/// Runs in Rust rather than the renderer because reading another site's HTML is
/// blocked by CORS in the webview.
#[tauri::command]
pub async fn fetch_link_metadata(
    urls: Vec<String>,
    concurrency: Option<u32>,
) -> Result<Vec<LinkMetadata>, String> {
    let client = reqwest::Client::builder()
        .user_agent(
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 \
             (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
        )
        .timeout(Duration::from_secs(TIMEOUT_SECS))
        .redirect(reqwest::redirect::Policy::limited(5))
        .build()
        .map_err(|e| format!("Could not build HTTP client: {e}"))?;

    let permits = Arc::new(Semaphore::new(concurrency.unwrap_or(6).clamp(1, 12) as usize));
    let mut handles = Vec::with_capacity(urls.len());

    for url in urls.into_iter().take(60) {
        let client = client.clone();
        let permits = permits.clone();
        handles.push(tokio::spawn(async move {
            let _permit = permits.acquire().await;
            fetch_one(&client, url).await
        }));
    }

    let mut out = Vec::with_capacity(handles.len());
    for handle in handles {
        match handle.await {
            Ok(metadata) => out.push(metadata),
            Err(e) => out.push(failure(String::new(), format!("task failed: {e}"))),
        }
    }

    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_og_image_when_property_precedes_content() {
        let html = r#"<html><head>
            <meta property="og:image" content="https://cdn.example.com/hero.png" />
        </head></html>"#;
        assert_eq!(
            meta_content(html, &["og:image"]).as_deref(),
            Some("https://cdn.example.com/hero.png")
        );
    }

    #[test]
    fn reads_og_image_when_content_precedes_property() {
        // Attribute order varies between sites, so both orders must work.
        let html = r#"<meta content="https://cdn.example.com/hero.png" property="og:image">"#;
        assert_eq!(
            meta_content(html, &["og:image"]).as_deref(),
            Some("https://cdn.example.com/hero.png")
        );
    }

    #[test]
    fn falls_back_to_twitter_image() {
        let html = r#"<meta name="twitter:image" content="https://cdn.example.com/tw.png">"#;
        assert_eq!(
            meta_content(html, &["og:image", "twitter:image"]).as_deref(),
            Some("https://cdn.example.com/tw.png")
        );
    }

    #[test]
    fn resolves_relative_image_against_the_page_url() {
        assert_eq!(
            absolute_url("https://example.com/blog/post/", "/static/hero.png").as_deref(),
            Some("https://example.com/static/hero.png")
        );
        assert_eq!(
            absolute_url("https://example.com/blog/post/", "hero.png").as_deref(),
            Some("https://example.com/blog/post/hero.png")
        );
        assert_eq!(
            absolute_url("https://example.com/", "https://other.com/abs.png").as_deref(),
            Some("https://other.com/abs.png")
        );
    }

    #[test]
    fn falls_back_to_the_document_title_and_collapses_whitespace() {
        let html = "<title>\n   Scaling   test-time compute\n</title>";
        assert_eq!(
            document_title(html).as_deref(),
            Some("Scaling test-time compute")
        );
    }

    #[test]
    fn decodes_entities_in_extracted_values() {
        let html = r#"<meta property="og:description" content="Rust &amp; TypeScript &quot;work&quot;">"#;
        assert_eq!(
            meta_content(html, &["og:description"]).as_deref(),
            Some("Rust & TypeScript \"work\"")
        );
    }

    #[test]
    fn returns_none_when_a_key_is_absent() {
        let html = "<html><head><title>No preview here</title></head></html>";
        assert_eq!(meta_content(html, &["og:image"]), None);
    }
}
