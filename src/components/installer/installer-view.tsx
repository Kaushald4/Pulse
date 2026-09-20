"use client";

import React from "react";
import { Loader2, RotateCw } from "lucide-react";
import { Button } from "../ui/button";
import { dismissSetup, runSetup, type SetupPhase, type SetupStatus } from "../../lib/setup";
import { InstallSteps, type StepState } from "./install-steps";
import { InstallTerminal, type TerminalLine } from "./install-terminal";
import { PulseMark, PulseWordmark } from "./pulse-brand";

/** How a streamed phase leaves the checklist. */
const PHASE_STATE: Record<SetupPhase, StepState> = {
  start: "running",
  line: "running",
  done: "installed",
  failed: "failed",
  skip: "skipped",
};

const SETTLED: StepState[] = ["ready", "installed", "failed", "skipped"];

/**
 * The first-run installer.
 *
 * Shown before the app itself when a component is missing, so Node, helmsman and
 * Scrapling are in place by the time anything tries to use them. It installs
 * unprompted on first launch (that is what makes it "first run"), and the log
 * below is the real output of the real commands.
 */
export function InstallerView({ status, onDone }: { status: SetupStatus; onDone: () => void }) {
  const [states, setStates] = React.useState<Record<string, StepState>>(() =>
    Object.fromEntries(status.steps.map((step) => [step.id, step.ready ? "ready" : "pending"]))
  );
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [lines, setLines] = React.useState<TerminalLine[]>([]);
  const [running, setRunning] = React.useState(false);
  const [blocked, setBlocked] = React.useState(false);
  const [finished, setFinished] = React.useState(false);
  const counter = React.useRef(0);
  /**
   * Installing is not re-entrant: two runs would unpack helmsman into the same
   * directory at once. React's development double-invoke would otherwise start
   * the whole thing twice.
   */
  const active = React.useRef(false);

  const push = React.useCallback((step: string, phase: SetupPhase, text: string) => {
    counter.current += 1;
    setLines((current) => [...current, { id: counter.current, step, phase, text }]);
  }, []);

  const install = React.useCallback(async () => {
    if (active.current) return;
    active.current = true;

    setRunning(true);
    setFinished(false);
    setBlocked(false);
    setErrors({});
    setStates((current) =>
      Object.fromEntries(
        Object.entries(current).map(([id, state]) => [id, state === "ready" ? state : "pending"])
      )
    );

    try {
      const result = await runSetup((progress) => {
        push(progress.step, progress.status, progress.text);
        setStates((current) => ({ ...current, [progress.step]: PHASE_STATE[progress.status] }));
        if (progress.status === "failed") {
          setErrors((current) => ({ ...current, [progress.step]: progress.text }));
        }
      });

      // Trust the final report over the last streamed line: a step that was
      // already installed never emits a "done".
      setStates((current) => {
        const next = { ...current };
        for (const outcome of result.results) {
          next[outcome.id] = outcome.status === "failed" ? "failed" : outcome.status;
          if (outcome.error) {
            setErrors((current) => ({ ...current, [outcome.id]: outcome.error as string }));
          }
        }
        return next;
      });
      setBlocked(result.blocked);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      push("setup", "failed", message);
      setBlocked(true);
    } finally {
      active.current = false;
      setRunning(false);
      setFinished(true);
    }
  }, [push]);

  const missing = status.steps.some((step) => !step.ready);

  React.useEffect(() => {
    if (missing) void install();
    else setFinished(true);
    // Runs once: the installer is not something the user should have to trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const settled = status.steps.filter((step) => SETTLED.includes(states[step.id])).length;
  const percent = status.steps.length > 0 ? Math.round((settled / status.steps.length) * 100) : 100;

  const skip = async () => {
    await dismissSetup();
    onDone();
  };

  return (
    /*
     * Scrolls rather than clips.
     *
     * This used to be `items-center justify-center overflow-hidden`, which
     * silently cut the header off the top and the footer off the bottom as soon
     * as the content was taller than the window. `overflow-y-auto` on the frame
     * plus `min-h-full justify-center` on the column centres it when it fits and
     * scrolls it when it does not.
     */
    <div className="fixed inset-0 z-50 overflow-y-auto bg-background">
      <div
        className="pointer-events-none fixed inset-0"
        style={{
          background:
            "radial-gradient(720px 420px at 50% -8%, color-mix(in oklch, var(--primary) 16%, transparent), transparent 70%)",
        }}
        aria-hidden
      />

      <div className="relative mx-auto flex min-h-full w-full max-w-5xl flex-col justify-center gap-6 p-6 sm:p-8">
        <header className="flex flex-col items-center gap-3 text-center">
          <img
            src="/app-icon.png"
            alt=""
            className="size-14 rounded-2xl border border-border/60 shadow-sm"
            aria-hidden
          />
          <div className="flex items-baseline gap-2.5">
            <PulseWordmark className="text-2xl" />
            <span className="text-[11px] uppercase tracking-[0.32em] text-muted-foreground">
              Tech Radar
            </span>
          </div>
          <PulseMark className="h-5 w-32 text-primary" />
          <p className="max-w-md text-[13px] leading-5 text-muted-foreground">
            One-time setup. Pulse is installing the pieces it needs to read the web - everything
            stays on this machine, and nothing here touches your system Python.
          </p>
        </header>

        {/* Checklist beside the log, so the log is readable instead of a narrow strip. */}
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:items-stretch">
          <InstallSteps steps={status.steps} states={states} errors={errors} />
          <InstallTerminal lines={lines} running={running} />
        </div>

        <footer className="space-y-3">
          <div className="h-1 w-full overflow-hidden rounded-full bg-secondary">
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-300"
              style={{ width: `${percent}%` }}
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-[12px] text-muted-foreground">
              {running
                ? "Installing… this can take a minute."
                : blocked
                  ? "Something Pulse cannot install on its own is missing."
                  : missing
                    ? "All set."
                    : "Everything was already in place."}
            </span>

            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={() => void skip()} disabled={running}>
                Skip for now
              </Button>

              {finished && !running && (blocked ? (
                <>
                  <Button variant="outline" size="sm" onClick={onDone}>
                    Continue anyway
                  </Button>
                  <Button size="sm" className="gap-1.5" onClick={() => void install()}>
                    <RotateCw className="size-3.5" />
                    Try again
                  </Button>
                </>
              ) : (
                <Button size="sm" className="gap-1.5" onClick={onDone}>
                  Continue to Pulse
                </Button>
              ))}

              {running && (
                <Button size="sm" className="gap-1.5" disabled>
                  <Loader2 className="size-3.5 animate-spin" />
                  Working…
                </Button>
              )}
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}
