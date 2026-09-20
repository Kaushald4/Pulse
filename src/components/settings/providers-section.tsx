"use client";

import React from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Badge } from "../ui/badge";
import { EnvHint, Field, Hint, SectionIntro } from "./shared";
import type { AppConfig } from "../../lib/types";

function Status({ ready, missing }: { ready: boolean; missing: string }) {
  return ready ? (
    <Badge variant="success">Ready</Badge>
  ) : (
    <Badge variant="outline" className="text-muted-foreground">
      {missing}
    </Badge>
  );
}

export function ProvidersSection({
  draft,
  patch,
}: {
  draft: AppConfig;
  patch: (patch: Partial<AppConfig>) => void;
}) {
  const cloudflareReady = Boolean(draft.cloudflare.accountId.trim() && draft.cloudflare.apiToken.trim());
  const openrouterReady = Boolean(draft.openrouter.apiKey.trim());
  const compatibleReady = Boolean(
    draft.openaiCompatible.baseUrl.trim() && draft.openaiCompatible.apiKey.trim()
  );

  return (
    <div className="space-y-5">
      <SectionIntro title="Providers">
        Access keys for whichever providers you selected on the Models pane. You only need the ones you
        actually use — the rest can stay empty.
      </SectionIntro>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle>Cloudflare Workers AI</CardTitle>
            <Status ready={cloudflareReady} missing="Needs account ID and API token" />
          </div>
          <CardDescription>Home of Jev, and of Cloudflare-hosted chat models.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Account ID"
            placeholder="your Cloudflare account ID"
            value={draft.cloudflare.accountId}
            onChange={(event) =>
              patch({ cloudflare: { ...draft.cloudflare, accountId: event.target.value } })
            }
            hint={<EnvHint names={["CLOUDFLARE_ACCOUNT_ID"]} />}
          />
          <Field
            label="API token"
            type="password"
            placeholder="a token with Workers AI access"
            value={draft.cloudflare.apiToken}
            onChange={(event) => patch({ cloudflare: { ...draft.cloudflare, apiToken: event.target.value } })}
            hint={<EnvHint names={["CLOUDFLARE_API_TOKEN"]} />}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle>OpenRouter</CardTitle>
            <Status ready={openrouterReady} missing="Needs an API key" />
          </div>
          <CardDescription>One key for many chat models.</CardDescription>
        </CardHeader>
        <CardContent>
          <Field
            label="API key"
            type="password"
            placeholder="sk-or-…"
            value={draft.openrouter.apiKey}
            onChange={(event) => patch({ openrouter: { ...draft.openrouter, apiKey: event.target.value } })}
            hint={<EnvHint names={["OPENROUTER_API_KEY"]} />}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle>OpenAI-compatible</CardTitle>
            <Status ready={compatibleReady} missing="Needs a base URL and key" />
          </div>
          <CardDescription>
            Any service exposing <span className="font-mono text-[11px]">/chat/completions</span>.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Base URL"
            placeholder="https://api.openai.com/v1"
            value={draft.openaiCompatible.baseUrl}
            onChange={(event) =>
              patch({ openaiCompatible: { ...draft.openaiCompatible, baseUrl: event.target.value } })
            }
            hint={<EnvHint names={["OPENAI_BASE_URL"]} />}
          />
          <Field
            label="API key"
            type="password"
            placeholder="sk-…"
            value={draft.openaiCompatible.apiKey}
            onChange={(event) =>
              patch({ openaiCompatible: { ...draft.openaiCompatible, apiKey: event.target.value } })
            }
            hint={<EnvHint names={["OPENAI_API_KEY"]} />}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle>GitHub</CardTitle>
            <Status ready={Boolean(draft.githubToken.trim())} missing="Optional" />
          </div>
          <CardDescription>Raises the rate limit when Pulse looks up trending repositories.</CardDescription>
        </CardHeader>
        <CardContent>
          <Field
            label="Personal access token"
            type="password"
            placeholder="ghp_…"
            value={draft.githubToken}
            onChange={(event) => patch({ githubToken: event.target.value })}
          />
        </CardContent>
      </Card>

      <Hint>
        Keys are stored in <span className="font-mono">~/.pulse/config.json</span> on this machine and are used
        by the app&rsquo;s backend when it makes a request — they are never built into the app.
      </Hint>
    </div>
  );
}
