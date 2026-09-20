mod ai;
mod background;
mod config;
mod extract;
mod feed;
mod github;
mod helmsman;
mod library;
mod metadata;

use ai::{ai_chat, ai_jev, test_connection};
use config::{get_config, set_config};
use extract::extract_content;
use feed::fetch_feed;
use github::github_trending;
use helmsman::{
    check_profile_status, disconnect_profile, helmsman_status, install_helmsman, launch_auth_login,
    run_helmsman_extract,
};
use library::{export_library, import_library};
use metadata::fetch_link_metadata;
use tauri::{Emitter, Manager};
use tauri::menu::MenuBuilder;
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
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
            let handle = app.handle();
            let menu = MenuBuilder::new(handle)
                .text("show", "Open Pulse")
                .separator()
                .text("sync", "Sync now")
                .separator()
                .text("quit", "Quit Pulse")
                .build()?;

            let icon = app
                .default_window_icon()
                .cloned()
                .ok_or_else(|| "Pulse window icon is not configured".to_string())?;

            TrayIconBuilder::with_id("pulse-tray")
                .icon(icon)
                // This is the full Pulse mark. It must remain a color image;
                // template mode would turn the dark rounded background into a
                // blank white square in the macOS menu bar.
                .icon_as_template(false)
                .tooltip("Pulse")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "sync" => {
                        let _ = app.emit("tray-sync-request", ());
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                        if let Some(window) = tray.app_handle().get_webview_window("main") {
                            let visible = window.is_visible().unwrap_or(false);
                            if visible {
                                let _ = window.hide();
                            } else {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                    }
                })
                .build(handle)?;

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
            background::configure_background_scheduler,
            publish_widget_snapshot,
            send_notification,
            export_library,
            import_library
        ])
        .run(tauri::generate_context!())
        .expect("error while running pulse desktop application");
}
