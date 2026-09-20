# Native macOS widget

`PulseWidget` is a real WidgetKit extension. It reads `pulse-widget.json` from
the `group.com.pulse.desktop` App Group. The Tauri app publishes that snapshot
after each refresh, and the widget asks WidgetKit for a new timeline every 15
minutes.

The extension is intentionally kept in a native Xcode project instead of a
Tauri window. Build it with:

```sh
xcodebuild -project PulseWidget.xcodeproj -scheme PulseWidgetExtension -sdk macosx build CODE_SIGNING_ALLOWED=NO
```

The resulting `.appex` must be embedded in the signed `Pulse.app` under
`Contents/PlugIns` when producing a distributable macOS bundle. The host app
and extension both carry the same App Group entitlement.

This is a local-first distribution. A GitHub ZIP can be built and used
without a paid Apple Developer membership, but it will not have a Developer ID
signature or Apple notarization. On a Mac, the user can launch a trusted copy
with Finder: Control-click the app, choose **Open**, then confirm **Open**.
For a trusted local build, the equivalent terminal command is:

```sh
xattr -dr com.apple.quarantine /Applications/Pulse.app
```

Only do this for a copy downloaded from a source you trust. Developer ID and
notarization are the polished public-distribution path, not a runtime
requirement for the local app itself.

`scripts/build-macos.sh` deliberately leaves the extension out of the app and DMG it
builds — embedding the `.appex` in a distributable bundle needs a paid Apple Developer
account. To embed it into an already-built `Pulse.app`, run:

```sh
sh native/macos/embed-widget.sh
```

For release signing, sign the host and extension with the same team and App
Group entitlement after embedding them.
