//! Pulse: a local-first desk for reading and for the job hunt.
//!
//! This file is the wiring, and only the wiring: which modules exist, and how
//! they are attached to the Tauri app. Everything with actual behaviour lives
//! under the modules below.
//!
//! - [`app`] is the desktop shell: menu, tray, background sync, notifications.
//! - [`reading`] turns a URL, feed or repository into clean text.
//! - [`ai`] is the model calls, through Jev or any OpenAI-compatible provider.
//! - [`helmsman`] drives the extraction CLI that fetches what Pulse cannot.
//! - [`setup`] installs the things Pulse depends on but does not bundle.
//! - [`jobs`] and [`config`] are the job hunt and the stored settings.
//! - [`support`] is the cross-cutting process plumbing, depended on by all.

mod ai;
mod app;
mod config;
mod helmsman;
mod jobs;
mod reading;
mod setup;
mod support;

use ai::{ai_chat, ai_jev, test_connection};
use app::background::{self, BackgroundScheduler};
use app::{
    background_schedule_status, configure_background_scheduler, export_library, get_app_version, import_library, menu,
    publish_widget_snapshot, send_notification, set_tray_syncing, tray,
};
use config::{get_config, set_config};
use helmsman::{
    check_profile_status, disconnect_profile, helmsman_status, install_helmsman, launch_auth_login,
    run_helmsman_extract,
};
use jobs::{cancel_job_scan, pick_resume_file, save_job_file, scan_job_providers, JobScanState};
use reading::{extract_content, fetch_feed, fetch_link_metadata, github_trending};
use setup::{dismiss_setup, run_setup, setup_status};
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let scheduler = BackgroundScheduler::default();
    let job_scan = JobScanState::default();

    tauri::Builder::default()
        .manage(scheduler.clone())
        .manage(job_scan)
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        // Self-updating: `updater` checks the release manifest and installs an
        // update, and `process` restarts the app so the new build is what the
        // user actually sees.
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(move |app| {
            background::start(app.handle().clone(), scheduler.clone());
            menu::build(app.handle())?;
            tray::build(app.handle())?;

            if let Some(window) = app.get_webview_window("main") {
                let app_handle = app.handle().clone();
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        if let Some(window) = app_handle.get_webview_window("main") {
                            let _ = window.hide();
                        }
                    }
                });
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_app_version,
            helmsman_status,
            install_helmsman,
            check_profile_status,
            launch_auth_login,
            disconnect_profile,
            run_helmsman_extract,
            github_trending,
            fetch_link_metadata,
            fetch_feed,
            get_config,
            set_config,
            ai_jev,
            ai_chat,
            test_connection,
            extract_content,
            set_tray_syncing,
            configure_background_scheduler,
            background_schedule_status,
            publish_widget_snapshot,
            send_notification,
            export_library,
            import_library,
            pick_resume_file,
            save_job_file,
            scan_job_providers,
            cancel_job_scan,
            setup_status,
            run_setup,
            dismiss_setup
        ])
        .run(tauri::generate_context!())
        .expect("error while running pulse desktop application");
}
