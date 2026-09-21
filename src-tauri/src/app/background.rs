//! Scheduled sync.
//!
//! The timer lives here rather than in the UI, because the window spends most of
//! its life hidden in the tray, and because a schedule whose countdown restarts
//! on every launch is not a schedule.
//!
//! Time is kept as epoch milliseconds rather than as an [`Instant`], for two
//! reasons. The UI has to show the user a wall-clock time, which a monotonic clock
//! cannot express. And `Instant` does not advance while the machine sleeps, so a
//! laptop closed overnight would wake up believing that no time had passed and
//! quietly skip the run it owed.

use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{Emitter, Runtime, State};
use tokio::sync::Notify;

/// Cap on a single sleep. Only bounds how quickly a wall-clock jump is noticed;
/// when a run is imminent the loop sleeps exactly until it is due.
const MAX_SLEEP: Duration = Duration::from_secs(30);

const DEFAULT_INTERVAL_MINUTES: u64 = 360;
const MIN_INTERVAL_MINUTES: u64 = 1;
const MAX_INTERVAL_MINUTES: u64 = 24 * 60;

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|since| since.as_millis() as i64)
        .unwrap_or(0)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SchedulerConfig {
    pub enabled: bool,
    pub interval_minutes: u64,
    /// When the scheduled sync last ran, so a restart resumes the cadence instead
    /// of postponing it by a whole interval.
    #[serde(default)]
    pub last_run_at: Option<i64>,
}

/// What the timer is actually doing.
///
/// The UI renders this rather than a time it worked out for itself, because only
/// the timer knows when it last fired and how long it then waited.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SchedulerStatus {
    pub enabled: bool,
    pub interval_minutes: u64,
    pub next_run_at: Option<i64>,
    pub last_run_at: Option<i64>,
}

/// The payload of `background-sync-due`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DueEvent {
    pub fired_at: i64,
    pub next_run_at: i64,
}

#[derive(Debug)]
struct ScheduleState {
    enabled: bool,
    interval: Duration,
    next_run_at: Option<i64>,
    last_run_at: Option<i64>,
}

impl Default for ScheduleState {
    fn default() -> Self {
        Self {
            enabled: false,
            interval: Duration::from_secs(DEFAULT_INTERVAL_MINUTES * 60),
            next_run_at: None,
            last_run_at: None,
        }
    }
}

impl ScheduleState {
    fn interval_minutes(&self) -> u64 {
        (self.interval.as_secs() / 60).clamp(MIN_INTERVAL_MINUTES, MAX_INTERVAL_MINUTES)
    }

    fn interval_ms(&self) -> i64 {
        (self.interval_minutes() as i64) * 60_000
    }

    fn status(&self) -> SchedulerStatus {
        SchedulerStatus {
            enabled: self.enabled,
            interval_minutes: self.interval_minutes(),
            next_run_at: self.next_run_at,
            last_run_at: self.last_run_at,
        }
    }
}

#[derive(Debug, Clone, Default)]
pub struct BackgroundScheduler {
    inner: Arc<Mutex<ScheduleState>>,
    /// Wakes the loop when the schedule changes, so a new interval takes effect at
    /// once instead of after the sleep already in progress.
    wake: Arc<Notify>,
}

impl BackgroundScheduler {
    fn lock(&self) -> MutexGuard<'_, ScheduleState> {
        self.inner.lock().expect("background scheduler lock poisoned")
    }

    fn configure(&self, config: SchedulerConfig) -> SchedulerStatus {
        self.configure_at(config, now_ms())
    }

    fn configure_at(&self, config: SchedulerConfig, now: i64) -> SchedulerStatus {
        let minutes = config
            .interval_minutes
            .clamp(MIN_INTERVAL_MINUTES, MAX_INTERVAL_MINUTES);
        let interval_ms = (minutes as i64) * 60_000;

        let mut state = self.lock();
        state.enabled = config.enabled;
        state.interval = Duration::from_secs(minutes * 60);
        state.last_run_at = config.last_run_at;

        state.next_run_at = if !config.enabled {
            None
        } else {
            match config.last_run_at {
                // Still inside the current interval, so keep the original slot:
                // restarting the app must not push the run out by a whole
                // interval, which is how a daily schedule ends up never running.
                Some(last) if last + interval_ms > now => Some(last + interval_ms),
                // Ran before and the slot has passed, so it is owed. Run it now
                // rather than waiting out another full interval.
                Some(_) => Some(now),
                // Never run, so a fresh enable waits one interval.
                None => Some(now + interval_ms),
            }
        };

        let status = state.status();
        drop(state);
        self.wake.notify_one();
        status
    }

    fn status(&self) -> SchedulerStatus {
        self.lock().status()
    }

    /// How long the loop should sleep before looking again.
    fn wait(&self) -> Duration {
        let state = self.lock();
        if !state.enabled {
            return MAX_SLEEP;
        }
        match state.next_run_at {
            None => MAX_SLEEP,
            Some(at) => {
                let remaining = at - now_ms();
                if remaining <= 0 {
                    Duration::ZERO
                } else {
                    Duration::from_millis(remaining as u64).min(MAX_SLEEP)
                }
            }
        }
    }

    /// Fires when the scheduled moment has arrived, and advances the schedule.
    fn take_due(&self) -> Option<DueEvent> {
        self.take_due_at(now_ms())
    }

    fn take_due_at(&self, now: i64) -> Option<DueEvent> {
        let mut state = self.lock();
        if !state.enabled {
            return None;
        }

        let scheduled = state.next_run_at?;
        if scheduled > now {
            return None;
        }

        // Advance from the scheduled slot, not from the moment the loop noticed
        // it. Measuring from "now" would add the polling delay to every run and
        // the error would compound. Slots missed while the machine was asleep are
        // skipped rather than fired in a burst on wake.
        let interval_ms = state.interval_ms();
        let mut next = scheduled + interval_ms;
        if next <= now {
            next = now + interval_ms;
        }

        state.last_run_at = Some(now);
        state.next_run_at = Some(next);

        Some(DueEvent {
            fired_at: now,
            next_run_at: next,
        })
    }
}

#[tauri::command]
pub fn configure_background_scheduler(
    config: SchedulerConfig,
    scheduler: State<'_, BackgroundScheduler>,
) -> Result<SchedulerStatus, String> {
    Ok(scheduler.configure(config))
}

/// What the timer is doing right now, without changing it.
#[tauri::command]
pub fn background_schedule_status(
    scheduler: State<'_, BackgroundScheduler>,
) -> Result<SchedulerStatus, String> {
    Ok(scheduler.status())
}

pub fn start<R: Runtime>(app: tauri::AppHandle<R>, scheduler: BackgroundScheduler) {
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::select! {
                _ = tokio::time::sleep(scheduler.wait()) => {}
                // Reconfigured mid-sleep: recompute rather than wait it out.
                _ = scheduler.wake.notified() => continue,
            }
            if let Some(event) = scheduler.take_due() {
                let _ = app.emit("background-sync-due", event);
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A fixed point in time, so the assertions read as arithmetic rather than as
    /// whatever today happens to be.
    const START: i64 = 1_700_000_000_000;

    const MINUTE: i64 = 60_000;

    fn config(enabled: bool, minutes: u64, last_run_at: Option<i64>) -> SchedulerConfig {
        SchedulerConfig {
            enabled,
            interval_minutes: minutes,
            last_run_at,
        }
    }

    #[test]
    fn enabling_waits_one_interval() {
        let scheduler = BackgroundScheduler::default();
        let status = scheduler.configure_at(config(true, 30, None), START);
        assert_eq!(status.next_run_at, Some(START + 30 * MINUTE));
        assert!(scheduler.take_due_at(START + 29 * MINUTE).is_none());
    }

    #[test]
    fn a_disabled_schedule_never_fires() {
        let scheduler = BackgroundScheduler::default();
        let status = scheduler.configure_at(config(false, 1, None), START);
        assert_eq!(status.next_run_at, None);
        assert!(scheduler.take_due_at(START + 10 * 60 * MINUTE).is_none());
    }

    #[test]
    fn restarting_midway_keeps_the_slot() {
        let scheduler = BackgroundScheduler::default();
        // Ten minutes into an hourly interval, so half an hour is left, not an
        // hour. This is the case that used to postpone every scheduled run on
        // launch until the app was effectively never idle for long enough.
        let status = scheduler.configure_at(config(true, 60, Some(START)), START + 10 * MINUTE);
        assert_eq!(status.next_run_at, Some(START + 60 * MINUTE));
    }

    #[test]
    fn an_overdue_run_happens_immediately() {
        let scheduler = BackgroundScheduler::default();
        // Closed for five hours on an hourly schedule.
        let now = START + 5 * 60 * MINUTE;
        let status = scheduler.configure_at(config(true, 60, Some(START)), now);
        assert_eq!(status.next_run_at, Some(now));
        assert!(scheduler.take_due_at(now).is_some(), "the owed run fires at once");
    }

    #[test]
    fn the_cadence_does_not_drift_when_a_poll_is_late() {
        let scheduler = BackgroundScheduler::default();
        scheduler.configure_at(config(true, 1, None), START);

        // Each run is noticed twenty seconds late. The slots must stay on the
        // minute: measuring the next run from "now" would add those twenty
        // seconds every time round the loop.
        let mut scheduled = Vec::new();
        for step in 1..=5 {
            let noticed_at = START + step * MINUTE + 20_000;
            let event = scheduler.take_due_at(noticed_at).expect("due");
            scheduled.push(event.next_run_at);
        }

        let expected: Vec<i64> = (2..=6).map(|step| START + step * MINUTE).collect();
        assert_eq!(scheduled, expected);
    }

    #[test]
    fn waking_from_sleep_skips_missed_slots_instead_of_firing_them_all() {
        let scheduler = BackgroundScheduler::default();
        scheduler.configure_at(config(true, 60, None), START);

        // Five hours of sleep against an hourly schedule: one run is owed, not
        // five. A burst of them would hit the network five times over.
        let woke_at = START + 5 * 60 * MINUTE;
        let event = scheduler.take_due_at(woke_at).expect("due");
        assert_eq!(event.next_run_at, woke_at + 60 * MINUTE);
        assert!(scheduler.take_due_at(woke_at).is_none(), "only one run is owed");
    }

    #[test]
    fn the_interval_is_clamped_to_something_runnable() {
        let scheduler = BackgroundScheduler::default();
        assert_eq!(scheduler.configure_at(config(true, 0, None), START).interval_minutes, 1);
        assert_eq!(
            scheduler.configure_at(config(true, 100_000, None), START).interval_minutes,
            MAX_INTERVAL_MINUTES
        );
    }

    // The UI reads these by name, so a rename here would silently break the
    // Settings display and the arming of the timer rather than fail to compile.

    #[test]
    fn the_status_serialises_the_names_the_ui_reads() {
        let scheduler = BackgroundScheduler::default();
        let status = scheduler.configure_at(config(true, 30, None), START);
        let json = serde_json::to_value(&status).expect("serialises");

        assert_eq!(json["enabled"], serde_json::json!(true));
        assert_eq!(json["intervalMinutes"], serde_json::json!(30));
        assert_eq!(json["nextRunAt"], serde_json::json!(START + 30 * MINUTE));
        assert_eq!(json["lastRunAt"], serde_json::Value::Null);
    }

    #[test]
    fn the_config_deserialises_what_the_ui_sends() {
        let config: SchedulerConfig = serde_json::from_value(serde_json::json!({
            "enabled": true,
            "intervalMinutes": 1,
            "lastRunAt": 1_700_000_000_000i64,
        }))
        .expect("deserialises");

        assert!(config.enabled);
        assert_eq!(config.interval_minutes, 1);
        assert_eq!(config.last_run_at, Some(1_700_000_000_000));
    }

    #[test]
    fn a_schedule_that_has_never_run_carries_no_last_run() {
        let config: SchedulerConfig = serde_json::from_value(serde_json::json!({
            "enabled": false,
            "intervalMinutes": 60,
        }))
        .expect("deserialises");

        assert_eq!(config.last_run_at, None);
    }

    #[test]
    fn the_due_event_serialises_the_names_the_ui_reads() {
        let scheduler = BackgroundScheduler::default();
        scheduler.configure_at(config(true, 1, None), START);
        let event = scheduler.take_due_at(START + MINUTE).expect("due");
        let json = serde_json::to_value(&event).expect("serialises");

        assert_eq!(json["firedAt"], serde_json::json!(START + MINUTE));
        assert_eq!(json["nextRunAt"], serde_json::json!(START + 2 * MINUTE));
    }
}
