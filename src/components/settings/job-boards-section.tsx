"use client";

import React from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { SectionIntro } from "./shared";
import { useJobs } from "../../store/jobs";
import type { AppConfig, ExtractionEngine } from "../../lib/types";

const ENGINE_HINTS: Record<ExtractionEngine, string> = {
  builtin: "Plain HTTP fetch. Free, no setup, and good enough for most board and ATS pages.",
  scrapling:
    "Renders the page in a real browser on this machine. Free per page, and it gets past the boards that 403 a plain fetch.",
  tinyfish:
    "Uses your TinyFish key, which is capped at 1,000 pages a day and is meant for article reading. Pick this only if you want to spend that allowance on jobs.",
};

/**
 * The job sources.
 *
 * The built-in boards are board-wide feeds that need no configuration. The
 * per-company providers (Greenhouse, Lever, Ashby, Workday, …) work off a
 * careers URL, so tracking a company is one entry here rather than a new
 * integration.
 */
export function JobBoardsSection({
  draft,
  patch,
}: {
  draft: AppConfig;
  patch: (patch: Partial<AppConfig>) => void;
}) {
  const sources = useJobs((state) => state.sources);
  const toggleSource = useJobs((state) => state.toggleSource);
  const addTrackedCompany = useJobs((state) => state.addTrackedCompany);
  const removeSource = useJobs((state) => state.removeSource);
  const init = useJobs((state) => state.init);

  const [name, setName] = React.useState("");
  const [careersUrl, setCareersUrl] = React.useState("");

  React.useEffect(() => {
    void init();
  }, [init]);

  const boards = sources.filter((source) => !source.careersUrl);
  const companies = sources.filter((source) => source.careersUrl);
  const engine = draft.jobsExtraction.engine;

  const add = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim() || !careersUrl.trim()) return;
    await addTrackedCompany(name, careersUrl);
    setName("");
    setCareersUrl("");
  };

  return (
    <div className="space-y-5">
      <SectionIntro title="Job boards">
        Where job listings come from, and how their pages are read. The built-in boards need nothing from you;
        tracking a company is a single careers link.
      </SectionIntro>

      <Card>
        <CardHeader>
          <CardTitle>Reading job pages</CardTitle>
          <CardDescription>
            Used to pull a description from a listing&rsquo;s own page. Separate from the article reader on
            purpose, so scanning jobs can&rsquo;t spend its TinyFish allowance.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="job-engine" className="text-xs">
              Engine
            </Label>
            <Select
              value={engine}
              onValueChange={(value) => patch({ jobsExtraction: { engine: value as ExtractionEngine } })}
            >
              <SelectTrigger id="job-engine" className="max-w-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="builtin">Built-in - free, no setup</SelectItem>
                <SelectItem value="scrapling">Scrapling - local browser, free per page</SelectItem>
                <SelectItem value="tinyfish">TinyFish - uses your daily allowance</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <p className="text-[12px] leading-5 text-muted-foreground">{ENGINE_HINTS[engine]}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Board feeds</CardTitle>
          <CardDescription>
            Board-wide aggregators. Turn one off if it duplicates another or never matches what you do.
          </CardDescription>
        </CardHeader>
        <CardContent className="divide-y divide-border">
          {boards.map((source) => (
            <label key={source.id} className="flex items-center justify-between gap-3 py-2.5">
              <span className="min-w-0 text-[13px] text-foreground">{source.name}</span>
              <Switch
                checked={source.enabled}
                onCheckedChange={(checked) => void toggleSource(source.id, checked)}
                aria-label={`Enable ${source.name}`}
              />
            </label>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Companies you track</CardTitle>
          <CardDescription>
            Paste a company&rsquo;s careers page - Pulse picks the right provider from the URL.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <form onSubmit={(event) => void add(event)} className="flex flex-wrap items-end gap-2">
            <div className="min-w-40 flex-1 space-y-1.5">
              <Label htmlFor="company-name" className="text-xs">
                Company
              </Label>
              <Input
                id="company-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Anthropic"
                className="h-9 text-[13px]"
              />
            </div>
            <div className="min-w-56 flex-[2] space-y-1.5">
              <Label htmlFor="company-careers" className="text-xs">
                Careers page
              </Label>
              <Input
                id="company-careers"
                value={careersUrl}
                onChange={(event) => setCareersUrl(event.target.value)}
                placeholder="https://job-boards.greenhouse.io/anthropic"
                className="h-9 text-[13px]"
              />
            </div>
            <Button type="submit" className="gap-1.5">
              <Plus className="size-3.5" />
              Track company
            </Button>
          </form>

          {companies.length > 0 && (
            <div className="divide-y divide-border rounded-lg border border-border">
              {companies.map((source) => (
                <div key={source.id} className="flex items-center justify-between gap-3 p-3">
                  <div className="min-w-0">
                    <p className="truncate text-[13px] text-foreground">{source.name}</p>
                    <p className="truncate text-[11px] text-muted-foreground">{source.careersUrl}</p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Stop tracking ${source.name}`}
                    title="Stop tracking"
                    onClick={() => void removeSource(source.id)}
                    className="size-8 shrink-0 text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
