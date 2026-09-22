"use client";

import React from "react";
import { Sparkles } from "lucide-react";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Textarea } from "../ui/textarea";
import { useJobs } from "../../store/jobs";
import type { GeneratedResume } from "../../lib/jobs/types";

/**
 * Edit a generated resume as text, or select a phrase and have it rewritten.
 * Changes are committed by Save, which is what re-renders the .docx.
 */
export function GeneratedResumeEditor({
  draft,
  open,
  onOpenChange,
}: {
  draft: GeneratedResume | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const rewriteSelection = useJobs((state) => state.rewriteSelection);
  const saveResumeContent = useJobs((state) => state.saveResumeContent);
  const areaRef = React.useRef<HTMLTextAreaElement>(null);
  const [content, setContent] = React.useState("");
  const [selection, setSelection] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    setContent(draft?.content ?? "");
    setSelection("");
  }, [draft?.id]);

  const rewrite = async () => {
    if (!draft || !selection.trim()) return;
    setBusy(true);
    try {
      const replacement = await rewriteSelection(draft.id, selection);
      if (!replacement) return;
      const area = areaRef.current;
      const start = area?.selectionStart ?? 0;
      const end = area?.selectionEnd ?? 0;
      const next = `${content.slice(0, start)}${replacement}${content.slice(end)}`;
      setContent(next);
      setSelection("");
      // Put the caret after the replacement so the change is visible.
      requestAnimationFrame(() => {
        area?.focus();
        area?.setSelectionRange(start, start + replacement.length);
      });
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!draft) return;
    setBusy(true);
    try {
      await saveResumeContent(draft.id, content);
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="truncate">{draft?.fileName ?? "Generated resume"}</DialogTitle>
          <DialogDescription>Select any text to rewrite just that part.</DialogDescription>
        </DialogHeader>

        {selection.trim() && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => void rewrite()}
            disabled={busy}
            className="w-fit gap-1.5"
          >
            <Sparkles className="size-3.5" />
            {busy ? "Rewriting…" : "Rewrite selection"}
          </Button>
        )}

        <Textarea
          ref={areaRef}
          value={content}
          onChange={(event) => setContent(event.target.value)}
          onSelect={(event) => {
            const area = event.currentTarget;
            setSelection(area.value.slice(area.selectionStart, area.selectionEnd));
          }}
          className="min-h-96 flex-1 resize-none font-mono text-xs leading-5"
        />

        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button size="sm" onClick={() => void save()} disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
