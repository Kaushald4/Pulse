//! The classification and generation call the frontend invokes.

use crate::config;
use serde::Deserialize;

use super::client::{chat_completion, LlmOutcome};

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
