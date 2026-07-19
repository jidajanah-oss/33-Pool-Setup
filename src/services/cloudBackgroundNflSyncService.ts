import { doc, getDoc } from "firebase/firestore";
import {
  getFunctions,
  httpsCallable,
} from "firebase/functions";
import { app, requireFirestore } from "../lib/firebase";
import type {
  CloudBackgroundNflSyncStatus,
} from "../types/cloud";

interface StoredBackgroundStatus {
  enabled?: unknown;
  outcome?: unknown;
  trigger?: unknown;
  week?: unknown;
  message?: unknown;
  provider?: unknown;
  eventCount?: unknown;
  teamCount?: unknown;
  finalTeamCount?: unknown;
  liveTeamCount?: unknown;
  scheduledTeamCount?: unknown;
  exceptionTeamCount?: unknown;
  fetchedAt?: unknown;
  completedAt?: unknown;
  nextRunMinutes?: unknown;
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : fallback;
}

function mapStatus(
  data: StoredBackgroundStatus,
): CloudBackgroundNflSyncStatus {
  const rawOutcome = asString(data.outcome);
  const outcome =
    rawOutcome === "success" ||
    rawOutcome === "skipped" ||
    rawOutcome === "error"
      ? rawOutcome
      : "waiting";
  const trigger =
    data.trigger === "callable" ? "callable" : "scheduled";

  return {
    enabled: data.enabled !== false,
    outcome,
    trigger,
    week: asNumber(data.week, 1),
    message: asString(
      data.message,
      "Waiting for the first background NFL sync.",
    ),
    provider: asString(data.provider, "ESPN NFL scoreboard"),
    event_count: asNumber(data.eventCount),
    team_count: asNumber(data.teamCount),
    final_team_count: asNumber(data.finalTeamCount),
    live_team_count: asNumber(data.liveTeamCount),
    scheduled_team_count: asNumber(data.scheduledTeamCount),
    exception_team_count: asNumber(data.exceptionTeamCount),
    fetched_at: asString(data.fetchedAt) || null,
    completed_at: asString(data.completedAt) || null,
    next_run_minutes: asNumber(data.nextRunMinutes, 10),
  };
}

export async function fetchBackgroundNflSyncStatus(): Promise<
  CloudBackgroundNflSyncStatus | null
> {
  const db = requireFirestore();
  const snapshot = await getDoc(doc(db, "nflSyncStatus", "main"));

  return snapshot.exists()
    ? mapStatus(snapshot.data() as StoredBackgroundStatus)
    : null;
}

export async function runSecureCloudNflSync(
  week: number,
): Promise<CloudBackgroundNflSyncStatus> {
  const functions = getFunctions(app, "us-east1");
  const sync = httpsCallable<
    { week: number },
    { status: StoredBackgroundStatus }
  >(functions, "syncNflWeekNow");
  const result = await sync({ week });

  return mapStatus(result.data.status);
}
