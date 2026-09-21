//! The macOS application menu.
//!
//! This exists for one reason: the About panel. macOS builds it from metadata the
//! app hands over, and Tauri's default supplies only the bundle's title and
//! version, so the panel reads as bare and unbranded. Passing the app's own
//! name, description, website and icon fills it in.
//!
//! macOS only. Windows and Linux have no such panel, and giving them a menu bar
//! would change the window layout for no benefit, so they are left alone.

use tauri::AppHandle;

#[cfg(target_os = "macos")]
pub fn build(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    use tauri::image::Image;
    use tauri::menu::{AboutMetadata, MenuBuilder, SubmenuBuilder};

    // Copied out of the bundle because the metadata borrows it, and the icon is
    // what makes the panel look like the app rather than like a generic binary.
    let icon = app
        .default_window_icon()
        .map(|icon| Image::new_owned(icon.rgba().to_vec(), icon.width(), icon.height()));

    let about = AboutMetadata {
        name: Some("Pulse".to_string()),
        version: Some(app.package_info().version.to_string()),
        comments: Some("A local-first signal desk for the tech world.".to_string()),
        copyright: Some("Open source.".to_string()),
        website: Some("https://github.com/Kaushald4/Pulse".to_string()),
        website_label: Some("Source on GitHub".to_string()),
        icon,
        ..Default::default()
    };

    let app_menu = SubmenuBuilder::new(app, "Pulse")
        .about(Some(about))
        .separator()
        .services()
        .separator()
        .hide()
        .hide_others()
        .separator()
        .quit()
        .build()?;

    // Kept deliberately: this app is mostly text fields, and cut, copy, paste and
    // select-all are only reachable through these items.
    let edit_menu = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;

    let view_menu = SubmenuBuilder::new(app, "View").fullscreen().build()?;

    let window_menu = SubmenuBuilder::new(app, "Window")
        .minimize()
        .separator()
        .close_window()
        .build()?;

    let menu = MenuBuilder::new(app)
        .items(&[&app_menu, &edit_menu, &view_menu, &window_menu])
        .build()?;

    app.set_menu(menu)?;
    Ok(())
}

/// Nothing to build where the OS has no menu bar of this kind.
#[cfg(not(target_os = "macos"))]
pub fn build(_app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    Ok(())
}
