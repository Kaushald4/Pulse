//! The desktop shell.
//!
//! Everything that is about the app rather than about the data it reads: the
//! window's menu bar, the tray icon, background syncing, notifications, and the
//! snapshot the macOS widget picks up.

pub mod background;
pub mod library;
pub mod menu;
pub mod shell;
pub mod tray;
pub mod widget;

pub use background::{background_schedule_status, configure_background_scheduler};
pub use library::{export_library, import_library};
pub use shell::{get_app_version, send_notification};
pub use tray::set_tray_syncing;
pub use widget::publish_widget_snapshot;
