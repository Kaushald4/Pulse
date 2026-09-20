use crate::config;
use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GithubRepo {
    pub id: String,
    pub name: String,
    pub url: String,
    pub description: Option<String>,
    pub author: String,
    pub stars: u64,
    pub language: Option<String>,
    pub created_at: String,
}

fn map_repo(value: &serde_json::Value) -> Option<GithubRepo> {
    let full_name = value.get("full_name")?.as_str()?.to_string();
    let url = value
        .get("html_url")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    if url.is_empty() {
        return None;
    }

    Some(GithubRepo {
        id: full_name.clone(),
        name: full_name.clone(),
        url,
        description: value
            .get("description")
            .and_then(|v| v.as_str())
            .map(String::from),
        author: value
            .get("owner")
            .and_then(|o| o.get("login"))
            .and_then(|v| v.as_str())
            .unwrap_or(full_name.split('/').next().unwrap_or("github"))
            .to_string(),
        stars: value
            .get("stargazers_count")
            .and_then(|v| v.as_u64())
            .unwrap_or(0),
        language: value.get("language").and_then(|v| v.as_str()).map(String::from),
        created_at: value
            .get("created_at")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
    })
}

/// Real "GitHub Trending": repositories created after `since` (YYYY-MM-DD), ranked by stars.
#[tauri::command]
pub async fn github_trending(
    since: String,
    language: Option<String>,
    limit: u32,
) -> Result<Vec<GithubRepo>, String> {
    let cfg = config::load();
    let limit = limit.clamp(1, 50);

    let mut query = format!("created:>{since} stars:>50");
    if let Some(lang) = language.as_deref().map(str::trim).filter(|l| !l.is_empty()) {
        query.push_str(&format!(" language:{lang}"));
    }

    let params = vec![
        ("q", query),
        ("sort", "stars".to_string()),
        ("order", "desc".to_string()),
        ("per_page", limit.to_string()),
    ];

    let client = reqwest::Client::builder()
        .user_agent("pulse-desktop")
        .build()
        .map_err(|e| format!("Could not build HTTP client: {e}"))?;

    let mut request = client
        .get("https://api.github.com/search/repositories")
        .query(&params);

    if !cfg.github_token.trim().is_empty() {
        request = request.header("authorization", format!("Bearer {}", cfg.github_token.trim()));
    }

    let response = request
        .send()
        .await
        .map_err(|e| format!("GitHub request failed: {e}"))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        let snippet: String = body.chars().take(200).collect();
        return Err(format!("GitHub API {status}: {snippet}"));
    }

    let data: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("GitHub returned invalid JSON: {e}"))?;

    Ok(data
        .get("items")
        .and_then(|v| v.as_array())
        .map(|items| items.iter().filter_map(map_repo).collect())
        .unwrap_or_default())
}
