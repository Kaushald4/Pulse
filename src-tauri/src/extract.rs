use crate::config;
use serde::Serialize;
use std::process::Command;
use std::time::Duration;

const TINYFISH_ENDPOINT: &str = "https://api.fetch.tinyfish.ai";
const MAX_BYTES: usize = 2 * 1024 * 1024;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtractedContent {
    pub url: String,
    pub engine: String,
    pub title: Option<String>,
    pub text: String,
    pub author: Option<String>,
    pub published_date: Option<String>,
    pub image_url: Option<String>,
    pub site_name: Option<String>,
    pub favicon: Option<String>,
    /// Raw outbound links found on the page, for resource capture.
    pub links: Vec<String>,
}

fn text_of(value: &serde_json::Value, pointer: &str) -> Option<String> {
    value
        .pointer(pointer)
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(String::from)
}

fn string_list(value: &serde_json::Value, pointer: &str) -> Vec<String> {
    value
        .pointer(pointer)
        .and_then(|v| v.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.as_str())
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(String::from)
                .collect()
        })
        .unwrap_or_default()
}

/* -------------------------------------------------------------------------- */
/* TinyFish                                                                   */
/* -------------------------------------------------------------------------- */

async fn extract_tinyfish(
    url: &str,
    api_key: &str,
) -> Result<ExtractedContent, String> {
    if api_key.trim().is_empty() {
        return Err("TinyFish API key is not set. Add it in Settings.".to_string());
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(60))
        .build()
        .map_err(|e| format!("Could not build HTTP client: {e}"))?;

    let response = client
        .post(TINYFISH_ENDPOINT)
        .header("X-API-Key", api_key.trim())
        .json(&serde_json::json!({
            "urls": [url],
            "format": "markdown",
            "links": true,
            "image_links": true,
            "page_metadata": true,
            "ttl": 0,
        }))
        .send()
        .await
        .map_err(|e| format!("TinyFish request failed: {e}"))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        let snippet: String = body.chars().take(200).collect();
        return Err(format!("TinyFish {status}: {snippet}"));
    }

    let payload: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("TinyFish returned invalid JSON: {e}"))?;

    if let Some(errors) = payload.get("errors").and_then(|v| v.as_array()) {
        if let Some(first) = errors.first() {
            let message = first.to_string();
            if !message.is_empty() && message != "[]" {
                return Err(format!("TinyFish reported an error: {}", message.chars().take(200).collect::<String>()));
            }
        }
    }

    let result = payload
        .pointer("/results/0")
        .ok_or_else(|| "TinyFish returned no result for that URL.".to_string())?;

    let text = text_of(result, "/text").unwrap_or_default();
    if text.trim().is_empty() {
        return Err("TinyFish returned no readable text for that page.".to_string());
    }

    Ok(ExtractedContent {
        url: url.to_string(),
        engine: "tinyfish".to_string(),
        title: text_of(result, "/title"),
        text,
        author: text_of(result, "/author"),
        published_date: text_of(result, "/published_date"),
        image_url: text_of(result, "/page_metadata/og/image")
            .or_else(|| text_of(result, "/page_metadata/twitter/image")),
        site_name: text_of(result, "/page_metadata/og/site_name"),
        favicon: text_of(result, "/page_metadata/favicon"),
        links: string_list(result, "/links"),
    })
}

/* -------------------------------------------------------------------------- */
/* Scrapling (local Python)                                                   */
/* -------------------------------------------------------------------------- */

/// Runs scrapling's Markdown converter through the local Python interpreter.
///
/// The script is passed with `-c` and the URL as argv so nothing is interpolated
/// into code, and it prints a single JSON object on stdout.
const SCRAPLING_SCRIPT: &str = r#"
import json, sys
try:
    from scrapling.fetchers import Fetcher
    page = Fetcher.get(sys.argv[1])
    markdown = page.markdown(main_content_only=True)
    print(json.dumps({"ok": True, "text": markdown or ""}))
except Exception as exc:
    print(json.dumps({"ok": False, "error": str(exc)}))
"#;

fn extract_scrapling(url: &str) -> Result<ExtractedContent, String> {
    let python = {
        let configured = config::load().extraction.python_path;
        let trimmed = configured.trim();
        if trimmed.is_empty() {
            "python3".to_string()
        } else {
            trimmed.to_string()
        }
    };

    let output = Command::new(&python)
        .arg("-c")
        .arg(SCRAPLING_SCRIPT)
        .arg(url)
        .output()
        .map_err(|e| format!("Could not run {python}: {e}. Install Python and `pip install \"scrapling[rag]\"`."))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let line = stdout
        .lines()
        .rev()
        .find(|line| line.trim_start().starts_with('{'))
        .ok_or_else(|| {
            let stderr = String::from_utf8_lossy(&output.stderr);
            format!(
                "scrapling produced no output. {}",
                stderr.trim().chars().take(200).collect::<String>()
            )
        })?;

    let parsed: serde_json::Value =
        serde_json::from_str(line).map_err(|e| format!("scrapling returned invalid JSON: {e}"))?;

    if parsed.get("ok").and_then(|v| v.as_bool()) != Some(true) {
        let detail = text_of(&parsed, "/error").unwrap_or_else(|| "unknown error".to_string());

        // The common case by far is "the library isn't installed", which the raw
        // `No module named 'scrapling'` says nothing useful about.
        if detail.contains("No module named") {
            return Err(format!(
                "Scrapling isn't installed for {python}. Run `{python} -m pip install \"scrapling[rag]\"`, \
                 or switch the engine back to Built-in in Settings."
            ));
        }

        return Err(format!("scrapling failed: {detail}"));
    }

    let text = text_of(&parsed, "/text").unwrap_or_default();
    if text.trim().is_empty() {
        return Err("scrapling returned no readable text for that page.".to_string());
    }

    Ok(ExtractedContent {
        url: url.to_string(),
        engine: "scrapling".to_string(),
        title: None,
        text,
        author: None,
        published_date: None,
        image_url: None,
        site_name: None,
        favicon: None,
        links: Vec::new(),
    })
}

/* -------------------------------------------------------------------------- */
/* Built-in fallback                                                          */
/* -------------------------------------------------------------------------- */

/// Minimal HTML → text, used when no external engine is configured. Crude on
/// purpose: it strips scripts, styles and tags, and leaves real extraction to
/// TinyFish or scrapling.
async fn extract_builtin(url: &str) -> Result<ExtractedContent, String> {
    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36")
        .timeout(Duration::from_secs(20))
        .redirect(reqwest::redirect::Policy::limited(5))
        .build()
        .map_err(|e| format!("Could not build HTTP client: {e}"))?;

    let response = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("Request failed: {e}"))?;

    if !response.status().is_success() {
        return Err(format!("HTTP {}", response.status()));
    }

    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("Could not read body: {e}"))?;
    let html = String::from_utf8_lossy(&bytes[..bytes.len().min(MAX_BYTES)]).to_string();

    let title = crate::metadata::document_title(&html);
    let links = crate::metadata::extract_hrefs(&html);

    Ok(ExtractedContent {
        url: url.to_string(),
        engine: "builtin".to_string(),
        title,
        text: strip_html(&html),
        author: None,
        published_date: None,
        image_url: None,
        site_name: None,
        favicon: None,
        links,
    })
}

/// Drops script/style/head content, then every remaining tag.
fn strip_html(html: &str) -> String {
    let mut out = String::with_capacity(html.len() / 4);
    let mut skip_until: Option<&str> = None;
    let bytes = html.as_bytes();
    let mut index = 0;

    while index < bytes.len() {
        if let Some(closer) = skip_until {
            if html[index..].to_ascii_lowercase().starts_with(closer) {
                index += closer.len();
                skip_until = None;
                continue;
            }
            index += 1;
            continue;
        }

        if bytes[index] == b'<' {
            let rest = html[index..].to_ascii_lowercase();
            for (open, close) in [("<script", "</script>"), ("<style", "</style>"), ("<noscript", "</noscript>")] {
                if rest.starts_with(open) {
                    skip_until = Some(close);
                    break;
                }
            }
            if skip_until.is_some() {
                index += 1;
                continue;
            }
            // Any other tag is markup we don't want.
            match html[index..].find('>') {
                Some(offset) => {
                    index += offset + 1;
                    out.push(' ');
                    continue;
                }
                None => break,
            }
        }

        out.push(bytes[index] as char);
        index += 1;
    }

    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

/* -------------------------------------------------------------------------- */
/* Command                                                                    */
/* -------------------------------------------------------------------------- */

/// Fetches and cleans a page's content.
///
/// `engine` overrides the configured one for this call - job pages pass their
/// own so scanning listings never spends the article reader's TinyFish quota.
/// Blank or absent means "whatever Settings says for article reading".
#[tauri::command]
pub async fn extract_content(
    url: String,
    engine: Option<String>,
) -> Result<ExtractedContent, String> {
    let config = config::load();
    let engine = engine
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| match value {
            config::EXTRACTOR_TINYFISH => config::EXTRACTOR_TINYFISH,
            config::EXTRACTOR_SCRAPLING => config::EXTRACTOR_SCRAPLING,
            _ => config::EXTRACTOR_BUILTIN,
        })
        .map(str::to_string)
        .unwrap_or_else(|| config.resolved_extraction_engine());

    match engine.as_str() {
        "tinyfish" => extract_tinyfish(&url, &config.extraction.tinyfish_api_key).await,
        "scrapling" => {
            let owned = url.clone();
            tauri::async_runtime::spawn_blocking(move || extract_scrapling(&owned))
                .await
                .map_err(|e| format!("scrapling task failed: {e}"))?
        }
        _ => extract_builtin(&url).await,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_markup_and_script_bodies() {
        let html = r#"
            <html><head><title>Doc</title><style>p{color:red}</style></head>
            <body><h1>Hello</h1><script>alert('x')</script><p>World &amp; co</p></body></html>
        "#;
        let text = strip_html(html);
        assert!(text.contains("Hello"));
        assert!(text.contains("World"));
        assert!(!text.contains("alert"));
        assert!(!text.contains("color:red"));
    }
}
