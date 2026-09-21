mod ai;
mod background;
mod config;
mod extract;
mod feed;
mod github;
mod helmsman;
mod jobs;
mod library;
mod metadata;
mod node;
mod proc;
mod python;
mod setup;
mod tray;

use ai::{ai_chat, ai_jev, test_connection};
use config::{get_config, set_config};
use extract::extract_content;
use feed::fetch_feed;
use github::github_trending;
use jobs::{pick_resume_file, save_job_file, scan_job_providers};
use helmsman::{
    check_profile_status, disconnect_profile, helmsman_status, install_helmsman, launch_auth_login,
    run_helmsman_extract,
};
use library::{export_library, import_library};
use metadata::fetch_link_metadata;
use setup::{dismiss_setup, run_setup, setup_status};
use tauri::Manager;
use std::fs;
use std::path::PathBuf;

#[tauri::command]
fn send_notification(app: tauri::AppHandle, title: String, body: String) -> Result<(), String> {
    use tauri_plugin_notification::NotificationExt;
    app.notification()
        .builder()
        .title(title)
        .body(body)
        .show()
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn get_app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

#[tauri::command]
fn publish_widget_snapshot(snapshot: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let home = dirs::home_dir().ok_or_else(|| "Could not locate the home directory".to_string())?;
        let container = home.join("Library/Group Containers/group.com.pulse.desktop");
        fs::create_dir_all(&container).map_err(|error| error.to_string())?;
        let path: PathBuf = container.join("pulse-widget.json");
        fs::write(path, snapshot).map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let scheduler = background::BackgroundScheduler::default();
    tauri::Builder::default()
        .manage(scheduler.clone())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .setup(move |app| {
            background::start(app.handle().clone(), scheduler.clone());
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
            tray::set_tray_syncing,
            background::configure_background_scheduler,
            publish_widget_snapshot,
            send_notification,
            export_library,
            import_library,
            pick_resume_file,
            save_job_file,
            scan_job_providers,
            setup_status,
            run_setup,
            dismiss_setup
        ])
        .run(tauri::generate_context!())
        .expect("error while running pulse desktop application");
}
