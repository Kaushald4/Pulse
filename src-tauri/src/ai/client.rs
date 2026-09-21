//! The transport every model call goes through.
//!
//! Pulse talks to OpenAI-compatible chat endpoints, so one request builder and
//! one response unwrapper serve the classifier, the generator, Jev and the
//! connection test alike. Nothing here knows what a briefing or a score is.

use crate::config::{self, PulseConfig, TaskConfig};
use serde::Serialize;

pub(super) fn snippet(body: &str) -> String {
    body.chars().take(240).collect()
}

/// Resolves the chat-completions endpoint and bearer token for a provider.
fn chat_endpoint(config: &PulseConfig, provider: &str) -> Result<(String, String), String> {
    match provider {
        config::PROVIDER_CLOUDFLARE => {
            let account_id = config.cloudflare.account_id.trim();
            let api_token = config.cloudflare.api_token.trim();
            if account_id.is_empty() {
                return Err("Cloudflare account ID is not set.".to_string());
            }
            if api_token.is_empty() {
                return Err("Cloudflare API token is not set.".to_string());
            }
            Ok((
                format!(
                    "https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/v1/chat/completions"
                ),
                api_token.to_string(),
            ))
        }
        config::PROVIDER_OPENROUTER => {
            let api_key = config.openrouter.api_key.trim();
            if api_key.is_empty() {
                return Err("OpenRouter API key is not set.".to_string());
            }
            Ok((
                "https://openrouter.ai/api/v1/chat/completions".to_string(),
                api_key.to_string(),
            ))
        }
        config::PROVIDER_OPENAI_COMPATIBLE => {
            let base_url = config.openai_compatible.base_url.trim().trim_end_matches('/');
            let api_key = config.openai_compatible.api_key.trim();
            if base_url.is_empty() {
                return Err("OpenAI-compatible base URL is not set.".to_string());
            }
            if api_key.is_empty() {
                return Err("OpenAI-compatible API key is not set.".to_string());
            }
            Ok((format!("{base_url}/chat/completions"), api_key.to_string()))
        }
        other => Err(format!("Unknown provider \"{other}\".")),
    }
}

/// Cloudflare wraps model output in `{ result, success, errors, messages }`.
/// Tolerate a bare payload too.
pub(super) fn unwrap_result(value: &serde_json::Value) -> Result<serde_json::Value, String> {
    if let Some(success) = value.get("success").and_then(|v| v.as_bool()) {
        if !success {
            let errors = value
                .get("errors")
                .map(|e| e.to_string())
                .unwrap_or_else(|| "unknown error".to_string());
            return Err(format!("Cloudflare returned an error: {}", snippet(&errors)));
        }
        return Ok(value.get("result").cloned().unwrap_or(serde_json::Value::Null));
    }
    Ok(value.clone())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmOutcome {
    pub text: String,
    pub model: Option<String>,
    pub usage: Option<serde_json::Value>,
    pub provider: String,
}

/// Falls back to a provider-appropriate model when none is configured.
pub(super) fn default_model_for(provider: &str) -> &'static str {
    match provider {
        config::PROVIDER_OPENROUTER => config::DEFAULT_OPENROUTER_MODEL,
        _ => config::DEFAULT_CLOUDFLARE_LLM_MODEL,
    }
}

/// Runs a chat completion through the resolved provider for a task.
pub(super) async fn chat_completion(
    config: &PulseConfig,
    task: &TaskConfig,
    model_override: Option<&str>,
    system: Option<&str>,
    prompt: &str,
    json: bool,
) -> Result<LlmOutcome, String> {
    let provider = task.resolved_provider(config::PROVIDER_CLOUDFLARE);

    let model = model_override
        .map(str::trim)
        .filter(|m| !m.is_empty())
        .map(str::to_string)
        .or_else(|| {
            let configured = task.model.trim();
            if configured.is_empty() {
                None
            } else {
                Some(configured.to_string())
            }
        })
        .unwrap_or_else(|| default_model_for(&provider).to_string());

    let (url, token) = chat_endpoint(config, &provider)?;

    let mut messages = Vec::new();
    if let Some(system) = system.filter(|s| !s.trim().is_empty()) {
        messages.push(serde_json::json!({ "role": "system", "content": system }));
    }
    messages.push(serde_json::json!({ "role": "user", "content": prompt }));

    let mut body = serde_json::json!({
        "model": model,
        "messages": messages,
        "temperature": 0.3,
        "max_tokens": 1600,
    });
    if json {
        body["response_format"] = serde_json::json!({ "type": "json_object" });
    }

    let mut request = reqwest::Client::new().post(&url).bearer_auth(&token);
    if provider == config::PROVIDER_OPENROUTER {
        request = request
            .header("X-Title", "Pulse")
            .header("HTTP-Referer", "https://github.com/pulse-desktop");
    }

    let response = request
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("{provider} request failed: {e}"))?;

    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(format!("{provider} {status}: {}", snippet(&text)));
    }

    let value: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("{provider} returned invalid JSON: {e}"))?;

    Ok(LlmOutcome {
        text: value
            .pointer("/choices/0/message/content")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        model: value.get("model").and_then(|v| v.as_str()).map(String::from),
        usage: value.get("usage").cloned(),
        provider,
    })
}
