import { useEffect, useState } from "react";
import {
  fetchBackgroundNflSyncStatus,
  runSecureCloudNflSync,
} from "../../services/cloudBackgroundNflSyncService";
import type {
  CloudBackgroundNflSyncStatus,
  CloudScoringState,
} from "../../types/cloud";

function formatDate(value: string | null): string {
  if (!value) {
    return "Waiting for first run";
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString();
}

function outcomeLabel(
  status: CloudBackgroundNflSyncStatus | null,
): string {
  if (!status) {
    return "Waiting";
  }

  if (status.outcome === "success") {
    return "Running normally";
  }

  if (status.outcome === "skipped") {
    return "Standing by";
  }

  if (status.outcome === "error") {
    return "Needs attention";
  }

  return "Waiting";
}

export function CloudBackgroundNflSyncPanel({
  scoring,
}: {
  scoring: CloudScoringState;
}) {
  const [status, setStatus] =
    useState<CloudBackgroundNflSyncStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function refreshStatus() {
    setError("");

    try {
      setStatus(await fetchBackgroundNflSyncStatus());
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Background NFL sync status could not be loaded.",
      );
    }
  }

  useEffect(() => {
    void refreshStatus();
  }, []);

  async function runNow() {
    setBusy(true);
    setError("");
    setMessage("");

    try {
      const next = await runSecureCloudNflSync(
        scoring.selectedWeek,
      );
      setStatus(next);
      await scoring.refreshWeek(scoring.selectedWeek);
      setMessage(
        `Week ${scoring.selectedWeek} was synced securely in Firebase.`,
      );
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The secure cloud NFL sync failed.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="section-card cloud-background-sync-panel">
      <div className="generator-heading">
        <div>
          <p className="eyebrow">Package 14</p>
          <h2>Background NFL Score Sync</h2>
          <p>
            Firebase checks the active NFL week every 10 minutes,
            even when every phone and browser is closed. Manual
            commissioner overrides remain protected.
          </p>
        </div>
        <span
          className={`generator-status ${
            status?.outcome === "success" ? "locked" : ""
          }`}
        >
          {outcomeLabel(status)}
        </span>
      </div>

      <div className="background-sync-summary">
        <div>
          <small>Last cloud run</small>
          <strong>{formatDate(status?.completed_at ?? null)}</strong>
        </div>
        <div>
          <small>Last week checked</small>
          <strong>Week {status?.week ?? scoring.currentWeek}</strong>
        </div>
        <div>
          <small>Live teams</small>
          <strong>{status?.live_team_count ?? 0}</strong>
        </div>
        <div>
          <small>Final teams</small>
          <strong>{status?.final_team_count ?? 0}</strong>
        </div>
      </div>

      <div className="background-sync-message">
        <strong>{status?.provider ?? "ESPN NFL scoreboard"}</strong>
        <span>
          {status?.message ??
            "Deploy the Firebase functions to activate background syncing."}
        </span>
      </div>

      <div className="background-sync-actions">
        <button
          className="generator-primary"
          disabled={busy || Boolean(scoring.result)}
          onClick={() => void runNow()}
          type="button"
        >
          {busy
            ? "Running Secure Cloud Sync…"
            : `Sync Week ${scoring.selectedWeek} in Firebase`}
        </button>
        <button
          disabled={busy}
          onClick={() => void refreshStatus()}
          type="button"
        >
          Refresh Background Status
        </button>
      </div>

      {message && (
        <div className="generator-message success">{message}</div>
      )}
      {error && (
        <div className="generator-message error">{error}</div>
      )}

      <p className="background-sync-note">
        The scheduled function updates scores only. It never finalizes
        a week or pays a winner automatically.
      </p>
    </section>
  );
}
