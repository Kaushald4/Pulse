use crate::config::{self, PulseConfig, TaskConfig};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::Semaphore;

fn snippet(body: &str) -> String {
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
fn unwrap_result(value: &serde_json::Value) -> Result<serde_json::Value, String> {
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
fn default_model_for(provider: &str) -> &'static str {
    match provider {
        config::PROVIDER_OPENROUTER => config::DEFAULT_OPENROUTER_MODEL,
        _ => config::DEFAULT_CLOUDFLARE_LLM_MODEL,
    }
}

/// Runs a chat completion through the resolved provider for a task.
async fn chat_completion(
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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatCall {
    /// `classification` or `generation` - selects which TaskConfig to use.
    pub task: String,
    pub system: Option<String>,
    pub prompt: String,
    pub model: Option<String>,
    #[serde(default)]
    pub json: bool,
}

#[tauri::command]
pub async fn ai_chat(call: ChatCall) -> Result<LlmOutcome, String> {
    let config = config::load();

    let task = match call.task.as_str() {
        "classification" => config.classification.clone(),
        "generation" => config.generation.clone(),
        other => return Err(format!("Unknown task \"{other}\".")),
    };

    chat_completion(
        &config,
        &task,
        call.model.as_deref(),
        call.system.as_deref(),
        &call.prompt,
        call.json,
    )
    .await
}

/* -------------------------------------------------------------------------- */
/* Jev (Cloudflare System One)                                                 */
/* -------------------------------------------------------------------------- */

#[derive(Debug, Deserialize)]
pub struct JevCall {
    pub id: String,
    pub state: serde_json::Value,
    pub questions: serde_json::Value,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JevOutcome {
    pub id: String,
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub answers: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub usage: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

fn jev_failure(id: String, message: String) -> JevOutcome {
    JevOutcome {
        id,
        ok: false,
        model: None,
        answers: None,
        usage: None,
        error: Some(message),
    }
}

/// Runs a batch of System One requests against Cloudflare's `/ai/run`:
///
///   POST /accounts/{account_id}/ai/run
///   { "model": "typesafe/jev", "input": { "state": …, "questions": … } }
#[tauri::command]
pub async fn ai_jev(
    calls: Vec<JevCall>,
    concurrency: Option<u32>,
) -> Result<Vec<JevOutcome>, String> {
    let config = config::load();

    let account_id = config.cloudflare.account_id.trim().to_string();
    let api_token = config.cloudflare.api_token.trim().to_string();
    if account_id.is_empty() {
        return Err("Cloudflare account ID is not set. Add it in Settings.".to_string());
    }
    if api_token.is_empty() {
        return Err("Cloudflare API token is not set. Add it in Settings.".to_string());
    }

    let url = format!("https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/run");
    let model = config
        .classification
        .resolved_model(config::DEFAULT_JEV_MODEL);

    let client = reqwest::Client::new();
    let permits = Arc::new(Semaphore::new(concurrency.unwrap_or(6).clamp(1, 16) as usize));

    let mut handles = Vec::with_capacity(calls.len());
    for call in calls {
        let client = client.clone();
        let url = url.clone();
        let token = api_token.clone();
        let model = model.clone();
        let permits = permits.clone();

        handles.push(tokio::spawn(async move {
            let _permit = permits.acquire().await;

            let response = client
                .post(&url)
                .bearer_auth(&token)
                .json(&serde_json::json!({
                    "model": model,
                    "input": { "state": call.state, "questions": call.questions },
                }))
                .send()
                .await;

            let response = match response {
                Ok(response) => response,
                Err(e) => return jev_failure(call.id, format!("Jev request failed: {e}")),
            };

            if !response.status().is_success() {
                let status = response.status();
                let body = response.text().await.unwrap_or_default();
                return jev_failure(call.id, format!("Cloudflare {status}: {}", snippet(&body)));
            }

            let value: serde_json::Value = match response.json().await {
                Ok(value) => value,
                Err(e) => return jev_failure(call.id, format!("Invalid Cloudflare response: {e}")),
            };

            let result = match unwrap_result(&value) {
                Ok(result) => result,
                Err(e) => return jev_failure(call.id, e),
            };

            JevOutcome {
                id: call.id,
                ok: true,
                model: result.get("model").and_then(|v| v.as_str()).map(String::from),
                answers: result.get("answers").cloned(),
                usage: result.get("usage").cloned(),
                error: None,
            }
        }));
    }

    let mut outcomes = Vec::with_capacity(handles.len());
    for (index, handle) in handles.into_iter().enumerate() {
        match handle.await {
            Ok(outcome) => outcomes.push(outcome),
            Err(e) => outcomes.push(jev_failure(format!("call-{index}"), format!("Task failed: {e}"))),
        }
    }

    Ok(outcomes)
}

/* -------------------------------------------------------------------------- */
/* Connection test                                                             */
/* -------------------------------------------------------------------------- */

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProbeResult {
    ok: bool,
    provider: String,
    model: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    detail: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

fn probe_ok(provider: String, model: String, detail: String) -> ProbeResult {
    ProbeResult {
        ok: true,
        provider,
        model,
        detail: Some(detail),
        error: None,
    }
}

fn probe_err(provider: String, model: String, error: String) -> ProbeResult {
    ProbeResult {
        ok: false,
        provider,
        model,
        detail: None,
        error: Some(error),
    }
}

async fn probe_classification(config: &PulseConfig) -> ProbeResult {
    let task = &config.classification;
    let provider = task.resolved_provider(config::PROVIDER_CLOUDFLARE);
    let engine = task.engine.trim();

    let uses_jev = provider == config::PROVIDER_CLOUDFLARE
        && (engine.is_empty() || engine == config::ENGINE_JEV);

    if uses_jev {
        let model = task.resolved_model(config::DEFAULT_JEV_MODEL);
        let account_id = config.cloudflare.account_id.trim();
        let api_token = config.cloudflare.api_token.trim();
        if account_id.is_empty() || api_token.is_empty() {
            return probe_err(provider, model, "Cloudflare account ID or API token is not set.".into());
        }

        let url = format!("https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/run");
        let response = reqwest::Client::new()
            .post(&url)
            .bearer_auth(api_token)
            .json(&serde_json::json!({
                "model": model,
                "input": {
                    "state": "connectivity check",
                    "questions": {
                        "reachable": {
                            "type": "noul",
                            "instructions": "Is this a connectivity check?"
                        }
                    }
                },
            }))
            .send()
            .await;

        return match response {
            Err(e) => probe_err(provider, model, format!("Could not reach Cloudflare: {e}")),
            Ok(response) if !response.status().is_success() => {
                let status = response.status();
                let text = response.text().await.unwrap_or_default();
                probe_err(provider, model, format!("Cloudflare {status}: {}", snippet(&text)))
            }
            Ok(response) => match response.json::<serde_json::Value>().await {
                Err(e) => probe_err(provider, model, format!("Invalid response: {e}")),
                Ok(value) => match unwrap_result(&value) {
                    Err(e) => probe_err(provider, model, e),
                    Ok(result) => {
                        let served = result
                            .get("model")
                            .and_then(|v| v.as_str())
                            .unwrap_or(&model)
                            .to_string();
                        probe_ok(provider, model, format!("System One · served by {served}"))
                    }
                },
            },
        };
    }

    let model = if task.model.trim().is_empty() {
        default_model_for(&provider).to_string()
    } else {
        task.model.trim().to_string()
    };

    match chat_completion(
        config,
        task,
        None,
        Some("Reply with JSON only."),
        "Return exactly {\"ok\": true}.",
        true,
    )
    .await
    {
        Ok(outcome) => probe_ok(provider, model, format!("LLM JSON mode · {}", outcome.text.trim())),
        Err(e) => probe_err(provider, model, e),
    }
}

async fn probe_generation(config: &PulseConfig) -> ProbeResult {
    let task = &config.generation;
    let provider = task.resolved_provider(config::PROVIDER_CLOUDFLARE);
    let model = if task.model.trim().is_empty() {
        default_model_for(&provider).to_string()
    } else {
        task.model.trim().to_string()
    };

    match chat_completion(
        config,
        task,
        None,
        Some("Reply with one word."),
        "Reply with the word: ready",
        false,
    )
    .await
    {
        Ok(outcome) => probe_ok(provider, model, format!("Replied \"{}\"", outcome.text.trim())),
        Err(e) => probe_err(provider, model, e),
    }
}

/// Probes the classification and generation paths independently, so Settings can
/// show which one is misconfigured.
#[tauri::command]
pub async fn test_connection() -> Result<serde_json::Value, String> {
    let config = config::load();
    let (classification, generation) =
        tokio::join!(probe_classification(&config), probe_generation(&config));

    Ok(serde_json::json!({
        "classification": classification,
        "generation": generation,
    }))
}
