use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

pub const DEFAULT_JEV_MODEL: &str = "typesafe/jev";
pub const DEFAULT_CLOUDFLARE_LLM_MODEL: &str = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
pub const DEFAULT_OPENROUTER_MODEL: &str = "openai/gpt-4o-mini";

pub const PROVIDER_CLOUDFLARE: &str = "cloudflare";
pub const PROVIDER_OPENROUTER: &str = "openrouter";
pub const PROVIDER_OPENAI_COMPATIBLE: &str = "openai-compatible";

pub const ENGINE_JEV: &str = "jev";

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct CloudflareConfig {
    pub account_id: String,
    pub api_token: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct OpenRouterConfig {
    pub api_key: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct OpenAiCompatibleConfig {
    /// Base URL including the version segment where applicable,
    /// e.g. `https://api.openai.com/v1`. `/chat/completions` is appended.
    pub base_url: String,
    pub api_key: String,
}

pub const EXTRACTOR_TINYFISH: &str = "tinyfish";
pub const EXTRACTOR_SCRAPLING: &str = "scrapling";
pub const EXTRACTOR_BUILTIN: &str = "builtin";

/// How a page's full content is fetched for reading and summarisation.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ExtractionConfig {
    pub engine: String,
    /// TinyFish API key. Kept here, never in the frontend bundle.
    pub tinyfish_api_key: String,
    /// Interpreter used to run scrapling; blank means `python3`.
    pub python_path: String,
}

impl Default for ExtractionConfig {
    fn default() -> Self {
        Self {
            engine: EXTRACTOR_BUILTIN.to_string(),
            tinyfish_api_key: String::new(),
            python_path: String::new(),
        }
    }
}

/// How one task (classification or generation) is served.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct TaskConfig {
    pub provider: String,
    pub model: String,
    /// Classification only: `jev` (System One) or `llm` (JSON-mode chat).
    pub engine: String,
}

impl Default for TaskConfig {
    fn default() -> Self {
        Self {
            provider: PROVIDER_CLOUDFLARE.to_string(),
            model: DEFAULT_JEV_MODEL.to_string(),
            engine: ENGINE_JEV.to_string(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct PulseConfig {
    pub cloudflare: CloudflareConfig,
    pub openrouter: OpenRouterConfig,
    pub openai_compatible: OpenAiCompatibleConfig,
    pub classification: TaskConfig,
    pub generation: TaskConfig,
    pub extraction: ExtractionConfig,
    pub github_token: String,
}

impl Default for PulseConfig {
    fn default() -> Self {
        Self {
            cloudflare: CloudflareConfig::default(),
            openrouter: OpenRouterConfig::default(),
            openai_compatible: OpenAiCompatibleConfig::default(),
            classification: TaskConfig::default(),
            generation: TaskConfig {
                provider: PROVIDER_CLOUDFLARE.to_string(),
                model: DEFAULT_CLOUDFLARE_LLM_MODEL.to_string(),
                engine: String::new(),
            },
            extraction: ExtractionConfig::default(),
            github_token: String::new(),
        }
    }
}

impl PulseConfig {
    /// Which extraction engine to use; unknown/blank values fall back to builtin.
    pub fn resolved_extraction_engine(&self) -> String {
        match self.extraction.engine.trim() {
            EXTRACTOR_TINYFISH => EXTRACTOR_TINYFISH.to_string(),
            EXTRACTOR_SCRAPLING => EXTRACTOR_SCRAPLING.to_string(),
            _ => EXTRACTOR_BUILTIN.to_string(),
        }
    }
}

impl TaskConfig {
    /// Falls back to the task's natural default when the field is blank.
    pub fn resolved_provider(&self, fallback: &str) -> String {
        let provider = self.provider.trim();
        if provider.is_empty() {
            fallback.to_string()
        } else {
            provider.to_string()
        }
    }

    pub fn resolved_model(&self, fallback: &str) -> String {
        let model = self.model.trim();
        if model.is_empty() {
            fallback.to_string()
        } else {
            model.to_string()
        }
    }
}

pub fn config_path() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or_else(|| "Could not locate home directory".to_string())?;
    Ok(home.join(".pulse").join("config.json"))
}

/// Reads config from disk, then applies environment overrides.
pub fn load() -> PulseConfig {
    let mut config = load_file();

    for (key, slot) in [
        ("CLOUDFLARE_ACCOUNT_ID", &mut config.cloudflare.account_id),
        ("CLOUDFLARE_API_TOKEN", &mut config.cloudflare.api_token),
        ("OPENROUTER_API_KEY", &mut config.openrouter.api_key),
        ("OPENAI_BASE_URL", &mut config.openai_compatible.base_url),
        ("OPENAI_API_KEY", &mut config.openai_compatible.api_key),
        ("TINYFISH_API_KEY", &mut config.extraction.tinyfish_api_key),
    ] {
        if let Ok(value) = std::env::var(key) {
            if !value.is_empty() {
                *slot = value;
            }
        }
    }

    config
}

/// Config exactly as stored on disk, without environment overrides. Needed to
/// tell a value the user saved apart from one the shell exported.
pub fn load_file() -> PulseConfig {
    config_path()
        .ok()
        .and_then(|path| fs::read_to_string(path).ok())
        .and_then(|raw| serde_json::from_str::<serde_json::Value>(&raw).ok())
        .map(migrate)
        .unwrap_or_default()
}

pub fn save(config: &PulseConfig) -> Result<(), String> {
    let path = config_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Could not create config directory: {e}"))?;
    }
    let raw = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
    fs::write(&path, raw).map_err(|e| format!("Could not write config: {e}"))?;
    Ok(())
}

/// Maps the pre-provider config shape onto the current one so an existing
/// `~/.pulse/config.json` keeps working.
fn migrate(value: serde_json::Value) -> PulseConfig {
    let mut config: PulseConfig = serde_json::from_value(value.clone()).unwrap_or_default();

    let string_at = |pointer: &str| -> Option<String> {
        value
            .get(pointer)
            .and_then(|v| v.as_str())
            .map(str::to_string)
            .filter(|s| !s.is_empty())
    };

    if let Some(account_id) = string_at("accountId") {
        if config.cloudflare.account_id.is_empty() {
            config.cloudflare.account_id = account_id;
        }
    }
    if let Some(api_token) = string_at("apiToken") {
        if config.cloudflare.api_token.is_empty() {
            config.cloudflare.api_token = api_token;
        }
    }
    if let Some(jev_model) = string_at("jevModel") {
        if config.classification.model.is_empty() {
            config.classification.model = jev_model;
        }
    }
    if let Some(llm_model) = string_at("llmModel") {
        if config.generation.model.is_empty() {
            config.generation.model = llm_model;
        }
    }

    config
}

/// Returns what is stored on disk — not the env-merged view. Settings must not
/// present an exported variable as a saved value, or saving would copy the
/// environment into the config file. Env vars still apply at call time.
#[tauri::command]
pub fn get_config() -> PulseConfig {
    load_file()
}

#[tauri::command]
pub fn set_config(config: PulseConfig) -> Result<PulseConfig, String> {
    save(&config)?;
    Ok(config)
}
