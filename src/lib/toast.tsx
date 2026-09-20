"use client";

/**
 * Thin wrapper over shadcn's Sonner toast so call sites stay declarative
 * (`toast.success("Saved")`) instead of reaching for the primitive directly.
 */
import { toast as sonner } from "sonner";

export const toast = {
  info: (title: string, description?: string) => sonner(title, { description }),
  success: (title: string, description?: string) => sonner.success(title, { description }),
  error: (title: string, description?: string) => sonner.error(title, { description }),
};

export { Toaster } from "../components/ui/sonner";
