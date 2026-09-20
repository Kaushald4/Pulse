"use client";

import React from "react";
import {
  Sparkles,
  KeyRound,
  Radio,
  Database,
  Info,
  Check,
  RotateCcw,
  Loader2,
  MonitorSmartphone,
  BriefcaseBusiness,
} from "lucide-react";
import { Button } from "./ui/button";
import { cn } from "../lib/utils";
import { usePulse } from "../store/pulse";
import { ModelsSection } from "./settings/models-section";
import { ProvidersSection } from "./settings/providers-section";
import { SourcesSection } from "./settings/sources-section";
import { DataSection } from "./settings/data-section";
import { AboutSection } from "./settings/about-section";
import { PersonalSection } from "./settings/personal-section";
import { JobBoardsSection } from "./settings/job-boards-section";
import type { AppConfig } from "../lib/types";

type SectionId = "models" | "providers" | "sources" | "boards" | "personal" | "data" | "about";

const SECTIONS: Array<{
  id: SectionId;
  label: string;
  blurb: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: "models", label: "Models", blurb: "Sorting and writing", icon: Sparkles },
  { id: "providers", label: "Providers", blurb: "Keys and endpoints", icon: KeyRound },
  { id: "sources", label: "Sources", blurb: "Collection and reading", icon: Radio },
  { id: "boards", label: "Job boards", blurb: "Where jobs come from", icon: BriefcaseBusiness },
  { id: "personal", label: "Personal", blurb: "Signal and schedule", icon: Sparkles },
  { id: "data", label: "Data", blurb: "Backup and reset", icon: Database },
  { id: "about", label: "About", blurb: "Version and paths", icon: Info },
];

export function SettingsView() {
  const config = usePulse((state) => state.config);
  const desktop = usePulse((state) => state.desktop);
  const updateConfig = usePulse((state) => state.updateConfig);

  const [active, setActive] = React.useState<SectionId>("models");
  const [draft, setDraft] = React.useState<AppConfig>(config);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => setDraft(config), [config]);

  const dirty = JSON.stringify(draft) !== JSON.stringify(config);
  const patch = React.useCallback(
    (values: Partial<AppConfig>) => setDraft((current) => ({ ...current, ...values })),
    []
  );

  const save = async () => {
    setSaving(true);
    await updateConfig(draft);
    setSaving(false);
  };

  return (
    /*
     * The pane fills the shell instead of growing past it.
     *
     * `h-full` plus `min-h-0` on the two-pane grid is what keeps the title still
     * and gives the section list and the panel a scroll each. Without it the
     * whole settings page scrolled as one column, so the section list slid out of
     * view as soon as you were a card deep.
     */
    <div className="flex h-full flex-col gap-4">
      <div className="shrink-0">
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Models, providers and how Pulse collects content.
        </p>
      </div>

      {!desktop && (
        <div className="flex shrink-0 items-start gap-2.5 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3.5 text-xs leading-relaxed text-foreground">
          <MonitorSmartphone className="mt-0.5 size-4 shrink-0 text-amber-500" />
          <span>
            You are in the browser preview. Syncing, model calls and article fetching only work in the desktop
            app &mdash; run <span className="font-mono">pnpm tauri dev</span>.
          </span>
        </div>
      )}

      <div className="grid min-h-0 flex-1 gap-6 lg:grid-cols-[200px_minmax(0,1fr)]">
        <nav className="flex gap-1 overflow-x-auto lg:flex-col lg:overflow-y-auto lg:overflow-x-hidden lg:pr-1">
          {SECTIONS.map((section) => {
            const Icon = section.icon;
            const isActive = active === section.id;
            return (
              <button
                key={section.id}
                type="button"
                onClick={() => setActive(section.id)}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "flex shrink-0 items-start gap-2.5 rounded-lg px-3 py-2 text-left transition-colors",
                  isActive ? "bg-secondary text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                <Icon className={cn("mt-0.5 size-4 shrink-0", isActive && "text-primary")} />
                <span className="min-w-0">
                  <span className="block text-[13px] font-medium leading-tight">{section.label}</span>
                  <span className="hidden text-[11px] leading-tight text-muted-foreground lg:block">
                    {section.blurb}
                  </span>
                </span>
              </button>
            );
          })}
        </nav>

        <div className="min-h-0 overflow-y-auto lg:pr-2">
          {active === "models" && <ModelsSection draft={draft} patch={patch} />}
          {active === "providers" && <ProvidersSection draft={draft} patch={patch} />}
          {active === "sources" && <SourcesSection draft={draft} patch={patch} desktop={desktop} />}
          {active === "boards" && <JobBoardsSection draft={draft} patch={patch} />}
          {active === "personal" && <PersonalSection />}
          {active === "data" && <DataSection desktop={desktop} />}
          {active === "about" && <AboutSection />}
        </div>
      </div>

      {/* Always visible when there is something to save: the pane no longer scrolls. */}
      {dirty && (
        <div className="z-10 flex shrink-0 flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card px-3.5 py-3 shadow-lg">
          <span className="text-xs text-muted-foreground">You have unsaved changes.</span>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => setDraft(config)} className="gap-1.5">
              <RotateCcw className="size-3.5" />
              Discard
            </Button>
            <Button size="sm" onClick={() => void save()} disabled={saving} className="gap-1.5">
              {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
              {saving ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
