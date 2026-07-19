import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";

initializeApp();

const REGION = "us-east1";
const PRIMARY_UID = "jytf6FyhvoSnMEOsaV6OyWPNXfv2";
const PRIMARY_EMAIL = "jidajanah@gmail.com";
const ESPN_URL =
  "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard";

interface Team {
  code: string;
  name: string;
  byeWeek: number;
}

interface TeamScoreRow {
  teamCode: string;
  teamName: string;
  status:
    | "not_started"
    | "live"
    | "final"
    | "postponed"
    | "canceled"
    | "bye";
  score: number | null;
  source: "manual" | "espn" | "unknown";
  eventId: string | null;
  kickoffAt: string | null;
  statusDetail: string;
  syncedAt: string | null;
}

interface ProviderSummary {
  provider: string;
  week: number;
  fetchedAt: string;
  eventCount: number;
  teamCount: number;
  finalTeamCount: number;
  liveTeamCount: number;
  scheduledTeamCount: number;
  exceptionTeamCount: number;
}

type Trigger = "scheduled" | "callable";

const TEAMS: Team[] = [
  ["ARI", "Arizona Cardinals", 14], ["ATL", "Atlanta Falcons", 11],
  ["BAL", "Baltimore Ravens", 13], ["BUF", "Buffalo Bills", 7],
  ["CAR", "Carolina Panthers", 5], ["CHI", "Chicago Bears", 10],
  ["CIN", "Cincinnati Bengals", 6], ["CLE", "Cleveland Browns", 11],
  ["DAL", "Dallas Cowboys", 14], ["DEN", "Denver Broncos", 10],
  ["DET", "Detroit Lions", 6], ["GB", "Green Bay Packers", 11],
  ["HOU", "Houston Texans", 8], ["IND", "Indianapolis Colts", 13],
  ["JAX", "Jacksonville Jaguars", 7], ["KC", "Kansas City Chiefs", 5],
  ["LV", "Las Vegas Raiders", 13], ["LAC", "Los Angeles Chargers", 7],
  ["LAR", "Los Angeles Rams", 11], ["MIA", "Miami Dolphins", 6],
  ["MIN", "Minnesota Vikings", 6], ["NE", "New England Patriots", 11],
  ["NO", "New Orleans Saints", 8], ["NYG", "New York Giants", 8],
  ["NYJ", "New York Jets", 13], ["PHI", "Philadelphia Eagles", 10],
  ["PIT", "Pittsburgh Steelers", 9], ["SF", "San Francisco 49ers", 8],
  ["SEA", "Seattle Seahawks", 11], ["TB", "Tampa Bay Buccaneers", 10],
  ["TEN", "Tennessee Titans", 9], ["WAS", "Washington Commanders", 7],
].map(([code, name, byeWeek]) => ({
  code: String(code),
  name: String(name),
  byeWeek: Number(byeWeek),
}));

const ESPN_TO_POOL_CODE: Record<string, string> = {
  WSH: "WAS",
  JAC: "JAX",
};

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function normalizeTeamCode(value: unknown): string {
  const raw = text(value).trim().toUpperCase();
  return ESPN_TO_POOL_CODE[raw] ?? raw;
}

function scoreValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.round(value));
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? Math.max(0, parsed) : null;
  }
  return null;
}

function cleanStatus(value: unknown): string {
  return text(value)
    .replace(/\bSTATUS_[A-Z0-9_]+\b/g, "")
    .replace(/\s*·\s*·\s*/g, " · ")
    .replace(/^\s*·\s*|\s*·\s*$/g, "")
    .trim();
}

function statusDetail(type: Record<string, unknown> | undefined): string {
  const unique = new Map<string, string>();
  [type?.shortDetail, type?.detail, type?.description].forEach((value) => {
    const cleaned = cleanStatus(value);
    if (cleaned) unique.set(cleaned.toLowerCase(), cleaned);
  });
  return [...unique.values()].join(" · ");
}

function gameStatus(type: Record<string, unknown> | undefined): TeamScoreRow["status"] {
  const detail = statusDetail(type).toLowerCase();
  const state = text(type?.state).toLowerCase();
  if (detail.includes("cancel")) return "canceled";
  if (detail.includes("postpon") || detail.includes("suspend") || detail.includes("delay")) return "postponed";
  if (type?.completed === true || state === "post") return "final";
  if (state === "in") return "live";
  return "not_started";
}

function defaultRows(week: number, syncedAt: string): TeamScoreRow[] {
  return TEAMS.map((team) => ({
    teamCode: team.code,
    teamName: team.name,
    status: team.byeWeek === week ? "bye" : "not_started",
    score: null,
    source: "espn",
    eventId: null,
    kickoffAt: null,
    statusDetail: team.byeWeek === week ? "Official NFL bye" : "Schedule pending",
    syncedAt,
  }));
}

async function fetchWeek(week: number): Promise<{rows: TeamScoreRow[]; summary: ProviderSummary}> {
  const fetchedAt = new Date().toISOString();
  const query = new URLSearchParams({dates: "2026", seasontype: "2", week: String(week)});
  const response = await fetch(`${ESPN_URL}?${query}`, {
    headers: {Accept: "application/json"},
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`ESPN NFL scoreboard returned HTTP ${response.status}.`);
  const payload = await response.json() as {events?: unknown};
  const events = Array.isArray(payload.events) ? payload.events as Array<Record<string, unknown>> : [];
  if (!events.length) throw new Error(`No 2026 regular-season games were returned for Week ${week}.`);
  const rows = defaultRows(week, fetchedAt);
  const byCode = new Map(rows.map((row) => [row.teamCode, row]));

  for (const event of events) {
    const competitions = Array.isArray(event.competitions) ? event.competitions as Array<Record<string, unknown>> : [];
    const competition = competitions[0];
    const competitors = Array.isArray(competition?.competitors) ? competition.competitors as Array<Record<string, unknown>> : [];
    const competitionStatus = competition?.status as Record<string, unknown> | undefined;
    const eventStatus = event.status as Record<string, unknown> | undefined;
    const type = (competitionStatus?.type ?? eventStatus?.type) as Record<string, unknown> | undefined;
    const status = gameStatus(type);
    const detail = statusDetail(type) || "NFL game scheduled";
    const eventId = text(event.id) || null;
    const kickoffAt = text(event.date) || null;

    for (const competitor of competitors) {
      const team = competitor.team as Record<string, unknown> | undefined;
      const code = normalizeTeamCode(team?.abbreviation);
      const existing = byCode.get(code);
      if (!existing) continue;
      const parsed = scoreValue(competitor.score);
      byCode.set(code, {
        ...existing,
        status: existing.status === "bye" ? "bye" : status,
        score: existing.status === "bye" || (status !== "live" && status !== "final") ? null : parsed,
        source: "espn",
        eventId,
        kickoffAt,
        statusDetail: existing.status === "bye" ? "Official NFL bye" : detail,
        syncedAt: fetchedAt,
      });
    }
  }

  const finalRows = TEAMS.map((team) => byCode.get(team.code) ?? rows[0]);
  return {
    rows: finalRows,
    summary: {
      provider: "ESPN NFL scoreboard",
      week,
      fetchedAt,
      eventCount: events.length,
      teamCount: finalRows.filter((row) => row.status !== "bye").length,
      finalTeamCount: finalRows.filter((row) => row.status === "final").length,
      liveTeamCount: finalRows.filter((row) => row.status === "live").length,
      scheduledTeamCount: finalRows.filter((row) => row.status === "not_started").length,
      exceptionTeamCount: finalRows.filter((row) => row.status === "postponed" || row.status === "canceled").length,
    },
  };
}

async function writeStatus(input: {
  outcome: "success" | "skipped" | "error";
  trigger: Trigger;
  week: number;
  message: string;
  summary?: ProviderSummary;
}): Promise<Record<string, unknown>> {
  const db = getFirestore();
  const completedAt = new Date().toISOString();
  const status = {
    enabled: true,
    outcome: input.outcome,
    trigger: input.trigger,
    week: input.week,
    message: input.message,
    provider: input.summary?.provider ?? "ESPN NFL scoreboard",
    eventCount: input.summary?.eventCount ?? 0,
    teamCount: input.summary?.teamCount ?? 0,
    finalTeamCount: input.summary?.finalTeamCount ?? 0,
    liveTeamCount: input.summary?.liveTeamCount ?? 0,
    scheduledTeamCount: input.summary?.scheduledTeamCount ?? 0,
    exceptionTeamCount: input.summary?.exceptionTeamCount ?? 0,
    fetchedAt: input.summary?.fetchedAt ?? null,
    completedAt,
    nextRunMinutes: 10,
  };
  await db.doc("nflSyncStatus/main").set(status, {merge: false});
  return status;
}

async function isCommissioner(uid: string, email: string): Promise<boolean> {
  if (uid === PRIMARY_UID || email.toLowerCase() === PRIMARY_EMAIL) return true;
  const team = await getFirestore().doc("commissionerTeam/main").get();
  return team.exists && (team.data()?.backup1Uid === uid || team.data()?.backup2Uid === uid);
}

async function syncWeek(week: number, trigger: Trigger): Promise<Record<string, unknown>> {
  const db = getFirestore();
  if (!Number.isInteger(week) || week < 1 || week > 18) throw new Error("NFL week must be between 1 and 18.");
  const result = await db.doc(`weeklyResults/${week}`).get();
  if (result.exists) return writeStatus({outcome: "skipped", trigger, week, message: `Week ${week} is finalized, so background syncing is paused.`});

  const provider = await fetchWeek(week);
  const scoreRef = db.doc(`teamScores/${week}`);
  const existing = await scoreRef.get();
  const existingRows = existing.exists && Array.isArray(existing.data()?.rows) ? existing.data()?.rows as Array<Record<string, unknown>> : [];
  const manualByCode = new Map(existingRows.filter((row) => row.source === "manual").map((row) => [text(row.teamCode), row]));
  const merged = provider.rows.map((row) => manualByCode.get(row.teamCode) ?? row);
  const now = new Date().toISOString();
  await scoreRef.set({
    week,
    rows: merged,
    finalized: false,
    provider: provider.summary.provider,
    providerSummary: {
      provider: provider.summary.provider,
      week,
      fetched_at: provider.summary.fetchedAt,
      event_count: provider.summary.eventCount,
      team_count: provider.summary.teamCount,
      final_team_count: provider.summary.finalTeamCount,
      live_team_count: provider.summary.liveTeamCount,
      scheduled_team_count: provider.summary.scheduledTeamCount,
      exception_team_count: provider.summary.exceptionTeamCount,
    },
    lastSyncedAt: provider.summary.fetchedAt,
    updatedAt: now,
    updatedByUid: trigger === "scheduled" ? "firebase-background-sync" : "firebase-callable-sync",
  }, {merge: false});
  return writeStatus({outcome: "success", trigger, week, message: `Week ${week} NFL scores synced successfully. Manual commissioner overrides were preserved.`, summary: provider.summary});
}

export const scheduledNflScoreSync = onSchedule({
  schedule: "every 10 minutes",
  timeZone: "America/New_York",
  region: REGION,
  memory: "256MiB",
  timeoutSeconds: 120,
  maxInstances: 1,
}, async () => {
  const db = getFirestore();
  try {
    const config = await db.doc("poolConfig/main").get();
    const data = config.data();
    const week = typeof data?.currentWeek === "number" ? data.currentWeek : 1;
    if (!config.exists || data?.schedulesLocked !== true) {
      await writeStatus({outcome: "skipped", trigger: "scheduled", week, message: "The 2026 schedule is not locked, so background NFL syncing is standing by."});
      return;
    }
    await syncWeek(week, "scheduled");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown background NFL sync error.";
    logger.error("scheduledNflScoreSync failed", error);
    const config = await db.doc("poolConfig/main").get().catch(() => null);
    const week = typeof config?.data()?.currentWeek === "number" ? config.data()?.currentWeek : 1;
    await writeStatus({outcome: "error", trigger: "scheduled", week, message});
    throw error;
  }
});

export const syncNflWeekNow = onCall({
  region: REGION,
  memory: "256MiB",
  timeoutSeconds: 120,
  cors: true,
}, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in to Firebase first.");
  const email = text(request.auth.token.email);
  if (!(await isCommissioner(request.auth.uid, email))) {
    throw new HttpsError("permission-denied", "Commissioner access is required.");
  }
  const week = Number(request.data?.week);
  try {
    return {status: await syncWeek(week, "callable")};
  } catch (error) {
    const message = error instanceof Error ? error.message : "Secure cloud NFL sync failed.";
    await writeStatus({outcome: "error", trigger: "callable", week: Number.isInteger(week) ? week : 1, message});
    throw new HttpsError("internal", message);
  }
});
