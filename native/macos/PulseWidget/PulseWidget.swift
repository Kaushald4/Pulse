import SwiftUI
import WidgetKit

private let appGroup = "group.com.pulse.desktop"
private let snapshotName = "pulse-widget.json"

struct PulseWidgetItem: Codable, Identifiable {
    let title: String
    let source: String
    let url: String
    let publishedAt: String
    var id: String { url }
}

struct PulseWidgetSnapshot: Codable {
    let enabled: Bool
    let generatedAt: Date
    let items: [PulseWidgetItem]
}

struct PulseWidgetEntry: TimelineEntry {
    let date: Date
    let enabled: Bool
    let generatedAt: Date?
    let items: [PulseWidgetItem]
}

struct PulseWidgetProvider: TimelineProvider {
    func placeholder(in context: Context) -> PulseWidgetEntry {
        PulseWidgetEntry(date: .now, enabled: true, generatedAt: .now, items: [
            PulseWidgetItem(title: "Your signal desk is ready", source: "Pulse", url: "https://pulse.local", publishedAt: "")
        ])
    }

    func getSnapshot(in context: Context, completion: @escaping (PulseWidgetEntry) -> Void) {
        completion(loadEntry())
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<PulseWidgetEntry>) -> Void) {
        let entry = loadEntry()
        let refresh = Date(timeIntervalSinceNow: 15 * 60)
        completion(Timeline(entries: [entry], policy: .after(refresh)))
    }

    private func loadEntry() -> PulseWidgetEntry {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        let fileManager = FileManager.default
        var locations: [URL] = []
        if let container = fileManager.containerURL(forSecurityApplicationGroupIdentifier: appGroup) {
            locations.append(container.appendingPathComponent(snapshotName))
        }
        // Ad-hoc local builds can resolve the App Group URL differently from
        // the host process. Keep the documented local container as a fallback.
        locations.append(
            fileManager.homeDirectoryForCurrentUser
                .appendingPathComponent("Library/Group Containers")
                .appendingPathComponent(appGroup)
                .appendingPathComponent(snapshotName)
        )

        var snapshot: PulseWidgetSnapshot?
        for url in locations {
            guard let data = try? Data(contentsOf: url) else { continue }
            if let decoded = try? decoder.decode(PulseWidgetSnapshot.self, from: data) {
                snapshot = decoded
                break
            }
        }

        guard let snapshot else {
            return PulseWidgetEntry(date: .now, enabled: true, generatedAt: nil, items: [])
        }
        return PulseWidgetEntry(date: .now, enabled: snapshot.enabled, generatedAt: snapshot.generatedAt, items: snapshot.items)
    }
}

struct PulseMark: View {
    @Environment(\.widgetRenderingMode) private var renderingMode

    var body: some View {
        Group {
            if renderingMode == .fullColor {
                ZStack {
                    RoundedRectangle(cornerRadius: 7, style: .continuous)
                        .fill(Color(red: 0.08, green: 0.11, blue: 0.18))
                    HStack(spacing: 1.5) {
                        Capsule().fill(Color(red: 0.98, green: 0.35, blue: 0.45)).frame(width: 2, height: 8)
                        Capsule().fill(Color(red: 0.98, green: 0.35, blue: 0.45)).frame(width: 2, height: 16)
                        Capsule().fill(Color(red: 0.98, green: 0.35, blue: 0.45)).frame(width: 2, height: 10)
                        Circle().fill(Color(red: 0.25, green: 0.55, blue: 1)).frame(width: 4, height: 4)
                    }
                }
            } else {
                // Tinted desktop widgets flatten custom fills. Keep the Pulse
                // waveform recognizable instead of showing a blank tile.
                Image(systemName: "waveform.path.ecg")
                    .font(.system(size: 20, weight: .bold))
                    .foregroundStyle(.primary)
            }
        }
        .frame(width: 25, height: 25)
    }
}

struct PulseWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: PulseWidgetEntry

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                PulseMark()
                VStack(alignment: .leading, spacing: 1) {
                    Text("Pulse")
                        .font(.headline)
                    Text(entry.items.isEmpty ? "No new signal" : "Today’s signal")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Text("\(entry.items.count)")
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(.secondary)
            }

            if !entry.enabled {
                Text("Widget updates are paused in Pulse Settings.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .padding(.top, 4)
            } else if entry.items.isEmpty {
                Text("Open Pulse to sync your feeds.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .padding(.top, 4)
            } else {
                ForEach(entry.items.prefix(family == .systemSmall ? 1 : family == .systemMedium ? 3 : 5)) { item in
                    Link(destination: URL(string: item.url) ?? URL(string: "https://pulse.local")!) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(item.title)
                                .font(family == .systemSmall ? .caption : .subheadline.weight(.medium))
                                .lineLimit(family == .systemSmall ? 3 : 2)
                                .foregroundStyle(.primary)
                            Text(item.source)
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }
                    }
                    if item.id != entry.items.prefix(family == .systemSmall ? 1 : family == .systemMedium ? 3 : 5).last?.id {
                        Divider()
                    }
                }
            }
        }
        .containerBackground(.ultraThinMaterial, for: .widget)
        .widgetURL(URL(string: "pulse://today"))
    }
}

@main
struct PulseWidget: Widget {
    let kind = "PulseWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: PulseWidgetProvider()) { entry in
            PulseWidgetView(entry: entry)
        }
        .configurationDisplayName("Pulse signal desk")
        .description("A quick view of the latest items Pulse found today.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
    }
}
