"use client";

import React from "react";
import { FolderKanban, Plus, Trash2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { usePulse } from "../store/pulse";

export function ProjectsView() {
  const projects = usePulse((state) => state.projects);
  const addProject = usePulse((state) => state.addProject);
  const removeProject = usePulse((state) => state.removeProject);
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");

  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    await addProject(name, description);
    setName("");
    setDescription("");
  };

  return (
    <div className="space-y-5 pb-12">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Projects</h1>
        <p className="mt-1 text-[13px] text-muted-foreground">
          Keep research, tools, and decisions together around work you are actually doing.
        </p>
      </div>

      <form
        onSubmit={(event) => void create(event)}
        className="flex flex-wrap items-end gap-2 rounded-lg border border-dashed border-border p-4"
      >
        <label className="min-w-48 flex-1 space-y-1.5">
          <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Project name
          </span>
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="e.g. Build a retrieval system"
          />
        </label>
        <label className="min-w-56 flex-[1.5] space-y-1.5">
          <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Context
          </span>
          <Input
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="What are you trying to decide or build?"
          />
        </label>
        <Button type="submit" className="gap-1.5">
          <Plus className="size-3.5" />
          Create project
        </Button>
      </form>

      {projects.length === 0 ? (
        <div className="flex min-h-48 flex-col items-center justify-center rounded-lg border border-dashed border-border text-center">
          <FolderKanban className="size-7 text-muted-foreground" />
          <p className="mt-3 text-sm font-medium">No projects yet</p>
          <p className="mt-1 max-w-sm text-[13px] text-muted-foreground">
            Create one, then attach useful items from the reader drawer as you triage.
          </p>
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {projects.map((project) => (
            <Card key={project.id}>
              <CardHeader className="flex-row items-start justify-between gap-3 space-y-0 pb-3">
                <div className="min-w-0">
                  <CardTitle className="text-sm">{project.name}</CardTitle>
                  <p className="mt-1 text-[13px] leading-5 text-muted-foreground">
                    {project.description || "No context added yet."}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Delete ${project.name}`}
                  title="Delete project"
                  onClick={() => void removeProject(project.id)}
                  className="size-7 shrink-0 text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </CardHeader>
              <CardContent className="border-t border-border pt-3 text-xs text-muted-foreground">
                {project.itemIds.length} item{project.itemIds.length === 1 ? "" : "s"} attached
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
