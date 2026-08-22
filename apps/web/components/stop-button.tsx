"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "./ui";

/**
 * Bouton STOP AUTOMATISATION — visible partout (layout).
 * Effet instantané : flag global vérifié au début de chaque job
 * et immédiatement avant chaque envoi.
 */
export function StopButton({ paused }: { paused: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function toggle() {
    setBusy(true);
    try {
      await fetch("/api/automation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paused: !paused }),
      });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return paused ? (
    <Button variant="success" size="lg" onClick={toggle} disabled={busy}>
      ▶️ Reprendre l&apos;automatisation
    </Button>
  ) : (
    <Button variant="danger" size="lg" onClick={toggle} disabled={busy}>
      ⛔ STOP AUTOMATISATION
    </Button>
  );
}
