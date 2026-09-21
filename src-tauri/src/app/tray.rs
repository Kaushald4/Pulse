//! The menu-bar icon, and its busy state.
//!
//! Kept in a module rather than inline in `run()` because a sync changes it: the
//! icon gains a crimson dot, the tooltip says so, and the "Sync now" item is
//! disabled so a second run cannot be started on top of the first.

use tauri::image::Image;
use tauri::menu::{MenuBuilder, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, Wry};

const TRAY_ID: &str = "pulse-tray";
const SYNC_ITEM_ID: &str = "sync";

/// What a state change needs to reach, kept once the tray is built.
pub struct TrayState {
    idle: Image<'static>,
    syncing: Image<'static>,
    sync_item: MenuItem<Wry>,
}

/// Builds the tray icon and remembers both icon states.
pub fn build(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let idle = owned_default_icon(app)?;
    let syncing = with_activity_dot(&idle);

    let sync_item = MenuItem::with_id(app, SYNC_ITEM_ID, "Sync now", true, None::<&str>)?;

    let menu = MenuBuilder::new(app)
        .text("show", "Open Pulse")
        .separator()
        .item(&sync_item)
        .separator()
        .text("quit", "Quit Pulse")
        .build()?;

    TrayIconBuilder::with_id(TRAY_ID)
        .icon(idle.clone())
        // This is the full Pulse mark. It must remain a color image; template
        // mode would turn the dark rounded background into a blank white square
        // in the macOS menu bar.
        .icon_as_template(false)
        .tooltip("Pulse")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show" => show_window(app),
            SYNC_ITEM_ID => {
                let _ = app.emit("tray-sync-request", ());
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                if let Some(window) = app.get_webview_window("main") {
                    if window.is_visible().unwrap_or(false) {
                        let _ = window.hide();
                    } else {
                        show_window(app);
                    }
                }
            }
        })
        .build(app)?;

    app.manage(TrayState { idle, syncing, sync_item });
    Ok(())
}

/// Marks the tray busy or idle. The window calls this as a sync starts and ends.
///
/// Best-effort: there is no tray on every platform, and none of this is worth
/// failing a sync over.
#[tauri::command]
pub fn set_tray_syncing(app: AppHandle, syncing: bool) -> Result<(), String> {
    let Some(state) = app.try_state::<TrayState>() else {
        return Ok(());
    };

    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        let icon = if syncing { state.syncing.clone() } else { state.idle.clone() };
        tray.set_icon(Some(icon)).map_err(|error| error.to_string())?;
        tray.set_tooltip(Some(if syncing { "Pulse — syncing…" } else { "Pulse" }))
            .map_err(|error| error.to_string())?;
    }

    let _ = state.sync_item.set_text(if syncing { "Syncing…" } else { "Sync now" });
    let _ = state.sync_item.set_enabled(!syncing);

    Ok(())
}

/// An owned copy of the bundle icon.
///
/// `default_window_icon()` borrows from the app, so the icon cannot be held for
/// later swaps without copying it out first.
fn owned_default_icon(app: &AppHandle) -> Result<Image<'static>, String> {
    let icon = app
        .default_window_icon()
        .ok_or_else(|| "Pulse window icon is not configured".to_string())?;
    Ok(Image::new_owned(icon.rgba().to_vec(), icon.width(), icon.height()))
}

/// Draws the busy marker into the icon rather than shipping a second asset: the
/// tray icon *is* the app icon, so a separate file would need regenerating every
/// time the mark changes. Bottom-right, sized relative to the source, so it
/// survives whatever resolution the bundle supplies.
fn with_activity_dot(base: &Image<'_>) -> Image<'static> {
    /// Pulse crimson.
    const DOT: [u8; 4] = [0xe1, 0x1d, 0x48, 0xff];

    let width = base.width();
    let height = base.height();
    let mut rgba = base.rgba().to_vec();

    let radius = (width.min(height) as f32 / 4.5).max(2.0);
    let centre_x = width as f32 - radius - 1.0;
    let centre_y = height as f32 - radius - 1.0;

    for y in 0..height {
        for x in 0..width {
            let dx = x as f32 + 0.5 - centre_x;
            let dy = y as f32 + 0.5 - centre_y;
            if (dx * dx + dy * dy).sqrt() > radius {
                continue;
            }
            let index = ((y * width + x) * 4) as usize;
            if index + 4 <= rgba.len() {
                rgba[index..index + 4].copy_from_slice(&DOT);
            }
        }
    }

    Image::new_owned(rgba, width, height)
}

fn show_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}
