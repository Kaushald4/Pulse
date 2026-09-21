//! Jev, running on Cloudflare's System One.
//!
//! Reached over Cloudflare's own endpoint rather than the OpenAI-shaped one, and
//! optional: it only works when the user has configured it, so every failure here
//! is reported rather than raised.

use crate::config;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::Semaphore;

use super::client::{snippet, unwrap_result};

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
