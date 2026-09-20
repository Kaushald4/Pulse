"use client";

import React from "react";
import { Plus } from "lucide-react";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Textarea } from "../ui/textarea";
import { useJobs } from "../../store/jobs";

const EMPTY = { title: "", company: "", location: "", jobUrl: "", description: "" };

export function NewJobDialog() {
  const addJob = useJobs((state) => state.addJob);
  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState(EMPTY);
  const [saving, setSaving] = React.useState(false);

  const patch = (values: Partial<typeof EMPTY>) => setDraft((current) => ({ ...current, ...values }));
  const ready = draft.title.trim().length > 0 && draft.description.trim().length > 0;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!ready) return;
    setSaving(true);
    await addJob({
      title: draft.title,
      description: draft.description,
      company: draft.company,
      location: draft.location,
      jobUrl: draft.jobUrl,
    });
    setSaving(false);
    setDraft(EMPTY);
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="gap-1.5">
          <Plus className="size-3.5" />
          Add job
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add a job</DialogTitle>
          <DialogDescription>
            Paste a listing you found yourself. It is scored against your base resume straight away.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={(event) => void submit(event)} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="job-title" className="text-xs">
              Role
            </Label>
            <Input
              id="job-title"
              value={draft.title}
              onChange={(event) => patch({ title: event.target.value })}
              placeholder="Senior Backend Engineer"
              className="h-9 text-[13px]"
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="job-company" className="text-xs">
                Company
              </Label>
              <Input
                id="job-company"
                value={draft.company}
                onChange={(event) => patch({ company: event.target.value })}
                placeholder="Acme Corp"
                className="h-9 text-[13px]"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="job-location" className="text-xs">
                Location
              </Label>
              <Input
                id="job-location"
                value={draft.location}
                onChange={(event) => patch({ location: event.target.value })}
                placeholder="Remote"
                className="h-9 text-[13px]"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="job-url" className="text-xs">
              Link
            </Label>
            <Input
              id="job-url"
              value={draft.jobUrl}
              onChange={(event) => patch({ jobUrl: event.target.value })}
              placeholder="https://…"
              className="h-9 text-[13px]"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="job-description" className="text-xs">
              Description
            </Label>
            <Textarea
              id="job-description"
              value={draft.description}
              onChange={(event) => patch({ description: event.target.value })}
              placeholder="Paste the job description…"
              rows={8}
              className="text-[13px]"
            />
            <p className="text-[11px] text-muted-foreground">
              Required - scoring, resumes and cover letters are all written from it.
            </p>
          </div>

          <DialogFooter>
            <Button type="submit" disabled={!ready || saving} className="gap-1.5">
              {saving ? "Saving…" : "Save job"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
