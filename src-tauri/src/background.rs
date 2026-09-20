use serde::Deserialize;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{Emitter, Runtime, State};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SchedulerConfig {
    pub enabled: bool,
    pub interval_minutes: u64,
}

#[derive(Debug, Clone, Default)]
pub struct BackgroundScheduler {
    inner: Arc<Mutex<ScheduleState>>,
}

#[derive(Debug)]
struct ScheduleState {
    enabled: bool,
    interval: Duration,
    next_run: Option<Instant>,
}

impl Default for ScheduleState {
    fn default() -> Self {
        Self { enabled: false, interval: Duration::from_secs(360 * 60), next_run: None }
    }
}

impl BackgroundScheduler {
    fn configure(&self, config: SchedulerConfig) {
        let interval_minutes = config.interval_minutes.clamp(1, 24 * 60);
        let mut state = self.inner.lock().expect("background scheduler lock poisoned");
        state.enabled = config.enabled;
        state.interval = Duration::from_secs(interval_minutes * 60);
        state.next_run = config.enabled.then(|| Instant::now() + state.interval);
    }

    fn due(&self) -> bool {
        let mut state = self.inner.lock().expect("background scheduler lock poisoned");
        if !state.enabled || state.next_run.map(|next| next > Instant::now()).unwrap_or(true) {
            return false;
        }
        state.next_run = Some(Instant::now() + state.interval);
        true
    }
}

#[tauri::command]
pub fn configure_background_scheduler(
    config: SchedulerConfig,
    scheduler: State<'_, BackgroundScheduler>,
) -> Result<(), String> {
    scheduler.configure(config);
    Ok(())
}

pub fn start<R: Runtime>(app: tauri::AppHandle<R>, scheduler: BackgroundScheduler) {
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(30)).await;
            if scheduler.due() {
                let _ = app.emit("background-sync-due", ());
            }
        }
    });
}
