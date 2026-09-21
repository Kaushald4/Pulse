//! The Settings connection test.
//!
//! Sends one real classification and one real generation to whatever the user
//! configured, so the answer reflects the actual account rather than a ping.

use crate::config::{self, PulseConfig};
use serde::Serialize;

use super::client::{chat_completion, default_model_for, snippet, unwrap_result};

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
