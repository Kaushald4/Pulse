import { cn } from "../../lib/utils";

/** The wordmark: a crimson P, the rest in the foreground colour. */
export function PulseWordmark({ className }: { className?: string }) {
  return (
    <span className={cn("font-semibold tracking-tight", className)}>
      <span className="text-primary">P</span>
      <span className="text-foreground">ulse</span>
    </span>
  );
}

/** The heartbeat line from the icon, used as a divider and a small motif. */
export function PulseMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 132 24" className={className} fill="none" aria-hidden>
      <path
        d="M0 12h24l5-9 7 18 6-13 4 6h18"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="70" cy="12" r="3.2" fill="currentColor" />
      <path d="M78 12h54" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" opacity="0.3" />
    </svg>
  );
}
