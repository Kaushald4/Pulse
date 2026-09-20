"use client";

import React from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Loader2,
  PackageCheck,
  Sparkles,
  FileText,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import {
  EMPTY_HELMSMAN_STATUS,
  getHelmsmanStatus,
  installHelmsman,
  type HelmsmanStatus,
} from "../../lib/config";
import { getSetupStatus, type SetupStatus } from "../../lib/setup";
import { InstallerView } from "../installer/installer-view";
import { toast } from "../../lib/toast";
import { Field, Hint, SectionIntro } from "./shared";
import type { AppConfig, ExtractionEngine } from "../../lib/types";

export function SourcesSection({
  draft,
  patch,
  desktop,
}: {
  draft: AppConfig;
  patch: (patch: Partial<AppConfig>) => void;
  desktop: boolean;
}) {
  const [helmsman, setHelmsman] = React.useState<HelmsmanStatus>(EMPTY_HELMSMAN_STATUS);
  const [installing, setInstalling] = React.useState(false);
  /** Set while the full first-run installer is open over the settings page. */
  const [setup, setSetup] = React.useState<SetupStatus | null>(null);

  React.useEffect(() => {
    void getHelmsmanStatus().then(setHelmsman);
  }, []);

  const install = async () => {
    setInstalling(true);
    try {
      const result = await installHelmsman();
      toast.success(
        `helmsman ${result.version ?? "installed"}`,
        `Downloaded ${result.asset}. It is ready to use.`
      );
      setHelmsman(await getHelmsmanStatus());
      if (!result.node) {
        toast.error("Node.js not found", "helmsman needs Node.js 20 or newer on your PATH.");
      }
    } catch (err) {
      toast.error("Install failed", err instanceof Error ? err.message : String(err));
    } finally {
      setInstalling(false);
    }
  };

  const engine = draft.extraction.engine;

  return (
    <div className="space-y-5">
      {setup && (
        <InstallerView
          status={setup}
          onDone={() => {
            setSetup(null);
            // The badge above should reflect whatever the run just installed.
            void getHelmsmanStatus().then(setHelmsman);
          }}
        />
      )}

      <SectionIntro title="Sources">
        Two separate jobs: pulling items out of your feeds, and reading an article&rsquo;s full text when you
        ask for it in the reader.
      </SectionIntro>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle>Item collection</CardTitle>
            {helmsman.path ? (
              <Badge variant="success" className="gap-1">
                <CheckCircle2 className="size-3" />
                Installed
              </Badge>
            ) : (
              <Badge variant="outline" className="gap-1 text-muted-foreground">
                <AlertTriangle className="size-3" />
                Not installed
              </Badge>
            )}
          </div>
          <CardDescription>
            Pulse uses helmsman to read your sources. There is nothing to configure - install it once, and
            installing again updates it.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-muted/20 p-3.5">
            <div className="min-w-0 space-y-1">
              <p className="text-xs font-medium text-foreground">
                {helmsman.path ? `helmsman ${helmsman.version ?? ""}`.trim() : "helmsman is not installed yet"}
              </p>
              <p className="break-all font-mono text-[11px] text-muted-foreground">
                {helmsman.path ?? "Installing puts it in ~/.pulse/helmsman."}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button
                variant="outline"
                onClick={() => void getSetupStatus().then(setSetup)}
                className="gap-1.5"
              >
                <PackageCheck className="size-3.5" />
                Run setup
              </Button>
              <Button onClick={() => void install()} disabled={installing} className="gap-1.5">
                {installing ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
                {installing ? "Installing…" : "Install helmsman"}
              </Button>
            </div>
          </div>

          {helmsman.path && !helmsman.node && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-500" />
              <Hint>
                Node.js was not found on your PATH. helmsman runs through Node, so install Node.js 20 or newer
                before syncing.
              </Hint>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5">
            <FileText className="size-3.5 text-muted-foreground" />
            Article reading
          </CardTitle>
          <CardDescription>
            How the full text of a page is fetched by <em>Fetch &amp; summarize</em> in the reader. This
            matters more than the summary model, because it decides how much navigation and boilerplate noise
            reaches the summary.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <span className="text-xs font-medium text-foreground">Reader</span>
              <Select
                value={engine}
                onValueChange={(value) =>
                  patch({ extraction: { ...draft.extraction, engine: value as ExtractionEngine } })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="builtin">Built-in - no setup</SelectItem>
                  <SelectItem value="tinyfish">TinyFish - best quality</SelectItem>
                  <SelectItem value="scrapling">Scrapling - local and free</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {engine === "tinyfish" && (
              <Field
                label="TinyFish API key"
                type="password"
                placeholder="tf_…"
                value={draft.extraction.tinyfishApiKey}
                onChange={(event) =>
                  patch({ extraction: { ...draft.extraction, tinyfishApiKey: event.target.value } })
                }
              />
            )}

            {engine === "scrapling" && (
              <Field
                label="Python interpreter"
                placeholder="python3"
                value={draft.extraction.pythonPath}
                onChange={(event) =>
                  patch({ extraction: { ...draft.extraction, pythonPath: event.target.value } })
                }
              />
            )}
          </div>

          <Hint>
            {engine === "builtin" &&
              "Works immediately with no account. It fetches the page and strips scripts, styles and tags - good enough for simple articles, weaker on sites that render with JavaScript."}
            {engine === "tinyfish" &&
              "Returns clean Markdown with the page's title, description, images and links, and it also finds the tools and papers a page points at. Free tier is generous: up to 1,000 pages a day."}
            {engine === "scrapling" &&
              "Runs entirely on this machine at no cost per page, using a real browser to render JavaScript. Requires Python with scrapling installed (pip install \"scrapling[rag]\")."}
          </Hint>

          {!desktop && (
            <Hint className="flex items-center gap-1.5">
              <Sparkles className="size-3" />
              Available in the desktop app.
            </Hint>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
