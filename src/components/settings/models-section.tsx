"use client";

import React from "react";
import { CheckCircle2, AlertTriangle, Loader2, Sparkles, PenLine } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { testConnection } from "../../lib/config";
import { Field, Hint, SectionIntro } from "./shared";
import type { AiProvider, AppConfig, ClassifierEngine, ProbeResult } from "../../lib/types";

const PROVIDERS: Array<{ id: AiProvider; label: string }> = [
  { id: "cloudflare", label: "Cloudflare Workers AI" },
  { id: "openrouter", label: "OpenRouter" },
  { id: "openai-compatible", label: "OpenAI-compatible" },
];

const MODEL_EXAMPLE: Record<AiProvider, string> = {
  cloudflare: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
  openrouter: "openai/gpt-4o-mini",
  "openai-compatible": "gpt-4o-mini",
};

function ProbeRow({ label, probe, pending }: { label: string; probe: ProbeResult | null; pending: boolean }) {
  const state = pending ? "checking" : probe ? (probe.ok ? "ok" : "error") : "idle";

  return (
    <div className="flex min-w-0 items-start gap-2 text-xs">
      {state === "checking" && <Loader2 className="mt-0.5 size-3.5 shrink-0 animate-spin text-muted-foreground" />}
      {state === "ok" && <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-success" />}
      {state === "error" && <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-destructive" />}
      {state === "idle" && <span className="mt-0.5 size-3.5 shrink-0" />}
      <span className="w-24 shrink-0 text-muted-foreground">{label}</span>
      {probe ? (
        <span className="min-w-0 flex-1">
          <span className="font-mono text-[11px] text-foreground">{probe.model}</span>
          <span className="ml-1.5 text-[11px] text-muted-foreground">via {probe.provider}</span>
          <span className="block truncate text-[11px] text-muted-foreground">
            {probe.ok ? probe.detail : probe.error}
          </span>
        </span>
      ) : (
        <span className="text-[11px] text-muted-foreground">not tested yet</span>
      )}
    </div>
  );
}

export function ModelsSection({
  draft,
  patch,
}: {
  draft: AppConfig;
  patch: (patch: Partial<AppConfig>) => void;
}) {
  const [probes, setProbes] = React.useState<{
    classification: ProbeResult | null;
    generation: ProbeResult | null;
  }>({ classification: null, generation: null });
  const [testing, setTesting] = React.useState(false);

  const classification = draft.classification;

  const setClassification = (value: Partial<AppConfig["classification"]>) =>
    patch({ classification: { ...classification, ...value } });

  const setGeneration = (value: Partial<AppConfig["generation"]>) =>
    patch({ generation: { ...draft.generation, ...value } });

  const changeEngine = (engine: ClassifierEngine) => {
    // Jev exists only on Cloudflare, and each engine wants a different model.
    if (engine === "jev") {
      setClassification({ engine, provider: "cloudflare", model: "typesafe/jev" });
    } else {
      setClassification({
        engine,
        model: "",
        provider: classification.provider === "cloudflare" ? "openrouter" : classification.provider,
      });
    }
  };

  const runTest = async () => {
    setTesting(true);
    const result = await testConnection();
    setTesting(false);

    if (result.error) {
      setProbes({
        classification: { ok: false, provider: "-", model: "-", error: result.error },
        generation: null,
      });
      return;
    }
    setProbes({ classification: result.classification, generation: result.generation });
  };

  const bothOk = probes.classification?.ok === true && probes.generation?.ok === true;
  const anyFailed = probes.classification?.ok === false || probes.generation?.ok === false;

  return (
    <div className="space-y-5">
      <SectionIntro title="Models">
        Pulse uses two models: one to sort what arrives, one to write. They can be the same model or
        completely different providers.
      </SectionIntro>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5 text-2xl">
            Sorting incoming items
          </CardTitle>
          <CardDescription>
            Gives every item a category, a field, a topic and a signal score, which is what the feed ranks and
            filters on.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <span className="text-xs font-medium text-foreground">How it decides</span>
              <Select value={classification.engine} onValueChange={(value) => changeEngine(value as ClassifierEngine)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="jev">Jev - instant decisions</SelectItem>
                  <SelectItem value="llm">Chat model - JSON labels</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <span className="text-xs font-medium text-foreground">Provider</span>
              <Select
                value={classification.provider}
                disabled={classification.engine === "jev"}
                onValueChange={(value) => setClassification({ provider: value as AiProvider })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PROVIDERS.map((provider) => (
                    <SelectItem key={provider.id} value={provider.id}>
                      {provider.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Field
              label="Model"
              value={classification.model}
              placeholder={MODEL_EXAMPLE[classification.provider]}
              onChange={(event) => setClassification({ model: event.target.value })}
            />
          </div>

          <Hint>
            {classification.engine === "jev"
              ? "Jev returns a fixed answer plus a confidence score instead of prose, so it is fast and cannot invent a category. It runs only on Cloudflare Workers AI, which is why the provider is fixed."
              : "Your provider is asked for one JSON object per batch of eight items. A blank model uses the provider's default."}
          </Hint>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5 text-2xl">
            Writing
          </CardTitle>
          <CardDescription>
            Writes the daily briefing and the one-line &ldquo;why it matters&rdquo; note shown on each item.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <span className="text-xs font-medium text-foreground">Provider</span>
              <Select
                value={draft.generation.provider}
                onValueChange={(value) => setGeneration({ provider: value as AiProvider })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PROVIDERS.map((provider) => (
                    <SelectItem key={provider.id} value={provider.id}>
                      {provider.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Field
              className="sm:col-span-2"
              label="Model"
              value={draft.generation.model}
              placeholder={MODEL_EXAMPLE[draft.generation.provider]}
              onChange={(event) => setGeneration({ model: event.target.value })}
              hint="A blank model uses the provider's default."
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">Check the setup</CardTitle>
          <CardDescription>
            Sends one small request through each path and reports which model answered.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="outline" size="sm" onClick={() => void runTest()} disabled={testing}>
              {testing ? "Testing…" : "Test both"}
            </Button>
            {bothOk && <Badge variant="success">Both working</Badge>}
            {anyFailed && <Badge variant="destructive">Something needs attention</Badge>}
          </div>
          <div className="space-y-2">
            <ProbeRow label="Sorting" probe={probes.classification} pending={testing} />
            <ProbeRow label="Writing" probe={probes.generation} pending={testing} />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
