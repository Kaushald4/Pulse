/**
 * Shown when the desktop app can find no helmsman binary: one click downloads
 * it from GitHub, so there is no path to configure by hand.
 */
import React from "react";
import { AlertCircle, Download, Loader2 } from "lucide-react";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import {
  EMPTY_HELMSMAN_STATUS,
  getHelmsmanStatus,
  installHelmsman,
  type HelmsmanStatus,
} from "../../lib/config";
import { toast } from "../../lib/toast";
import { usePulse } from "../../store/pulse";

export function HelmsmanBanner() {
  const [status, setStatus] = React.useState<HelmsmanStatus>(EMPTY_HELMSMAN_STATUS);
  const [installing, setInstalling] = React.useState(false);
  const desktop = usePulse((state) => state.desktop);

  React.useEffect(() => {
    void getHelmsmanStatus().then(setStatus);
  }, []);

  if (!desktop || status.path) return null;

  const install = async () => {
    setInstalling(true);
    try {
      const result = await installHelmsman();
      toast.success(`helmsman ${result.version ?? "installed"}`, `Downloaded ${result.asset}`);
      setStatus(await getHelmsmanStatus());
    } catch (err) {
      toast.error("Install failed", err instanceof Error ? err.message : String(err));
    } finally {
      setInstalling(false);
    }
  };

  return (
    <Card className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-dashed p-4">
      <div className="flex min-w-0 items-start gap-2.5">
        <AlertCircle className="mt-0.5 size-4 shrink-0 text-warning" />
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-foreground">The extraction engine is not installed</p>
          <p className="text-[13px] text-muted-foreground">
            Pulse downloads helmsman from GitHub - one click, no path to configure.
          </p>
        </div>
      </div>
      <Button onClick={() => void install()} disabled={installing} className="shrink-0 gap-1.5">
        {installing ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
        {installing ? "Installing…" : "Install helmsman"}
      </Button>
    </Card>
  );
}
