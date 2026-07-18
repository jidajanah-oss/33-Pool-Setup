import { NFL_2026_TEAMS } from "../data/nfl2026";
import type {
  CloudNflSyncSummary,
  CloudTeamScore,
} from "../types/cloud";

const ESPN_SCOREBOARD_URL =
  "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard";

const ESPN_TO_POOL_CODE: Record<string, string> = {
  WSH: "WAS",
  JAC: "JAX",
};

interface EspnStatusType {
  completed?: unknown;
  state?: unknown;
  name?: unknown;
  description?: unknown;
  detail?: unknown;
  shortDetail?: unknown;
}

interface EspnCompetitor {
  score?: unknown;
  team?: {
    abbreviation?: unknown;
  };
}

interface EspnCompetition {
  competitors?: unknown;
  status?: {
    type?: EspnStatusType;
  };
}

interface EspnEvent {
  id?: unknown;
  date?: unknown;
  competitions?: unknown;
  status?: {
    type?: EspnStatusType;
  };
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function normalizeTeamCode(value: unknown): string {
  const raw = asString(value).trim().toUpperCase();
  return ESPN_TO_POOL_CODE[raw] ?? raw;
}

function parseScore(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.round(value));
  }

  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? Math.max(0, parsed) : null;
  }

  return null;
}

function cleanStatusText(value: unknown): string {
  return asString(value)
    .replace(/\bSTATUS_[A-Z0-9_]+\b/g, "")
    .replace(/\s*·\s*·\s*/g, " · ")
    .replace(/^\s*·\s*|\s*·\s*$/g, "")
    .trim();
}

function statusText(type: EspnStatusType | undefined): string {
  const unique = new Map<string, string>();

  [
    type?.shortDetail,
    type?.detail,
    type?.description,
  ].forEach((value) => {
    const cleaned = cleanStatusText(value);
    const key = cleaned.toLowerCase();

    if (cleaned && !unique.has(key)) {
      unique.set(key, cleaned);
    }
  });

  return [...unique.values()].join(" · ");
}

function statusFromEspn(type: EspnStatusType | undefined) {
  const text = statusText(type).toLowerCase();
  const state = asString(type?.state).toLowerCase();

  if (text.includes("cancel")) {
    return "canceled" as const;
  }

  if (
    text.includes("postpon") ||
    text.includes("suspend") ||
    text.includes("delay")
  ) {
    return "postponed" as const;
  }

  if (type?.completed === true || state === "post") {
    return "final" as const;
  }

  if (state === "in") {
    return "live" as const;
  }

  return "not_started" as const;
}

function defaultRows(week: number, syncedAt: string): CloudTeamScore[] {
  return NFL_2026_TEAMS.map((team) => ({
    team_code: team.code,
    team_name: team.name,
    status: team.byeWeek === week ? "bye" : "not_started",
    score: null,
    source: "espn",
    event_id: null,
    kickoff_at: null,
    status_detail:
      team.byeWeek === week ? "Official NFL bye" : "Schedule pending",
    synced_at: syncedAt,
  }));
}

export async function fetchEspnNflWeek(
  week: number,
): Promise<{
  scores: CloudTeamScore[];
  summary: CloudNflSyncSummary;
}> {
  if (!Number.isInteger(week) || week < 1 || week > 18) {
    throw new Error("NFL week must be between 1 and 18.");
  }

  const fetchedAt = new Date().toISOString();
  const query = new URLSearchParams({
    dates: "2026",
    seasontype: "2",
    week: String(week),
  });
  const response = await fetch(`${ESPN_SCOREBOARD_URL}?${query}`, {
    cache: "no-store",
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(
      `NFL scoreboard returned HTTP ${response.status}. Manual score entry is still available.`,
    );
  }

  const payload = (await response.json()) as { events?: unknown };
  const events = Array.isArray(payload.events)
    ? (payload.events as EspnEvent[])
    : [];

  if (events.length === 0) {
    throw new Error(
      `No 2026 regular-season games were returned for Week ${week}.`,
    );
  }

  const rows = defaultRows(week, fetchedAt);
  const byCode = new Map(rows.map((row) => [row.team_code, row]));

  events.forEach((event) => {
    const competition = Array.isArray(event.competitions)
      ? (event.competitions[0] as EspnCompetition | undefined)
      : undefined;
    const competitors = Array.isArray(competition?.competitors)
      ? (competition?.competitors as EspnCompetitor[])
      : [];
    const type = competition?.status?.type ?? event.status?.type;
    const eventStatus = statusFromEspn(type);
    const detail = statusText(type) || "NFL game scheduled";
    const eventId = asString(event.id) || null;
    const kickoffAt = asString(event.date) || null;

    competitors.forEach((competitor) => {
      const code = normalizeTeamCode(competitor.team?.abbreviation);
      const existing = byCode.get(code);

      if (!existing) {
        return;
      }

      const parsedScore = parseScore(competitor.score);
      const score =
        eventStatus === "live" || eventStatus === "final"
          ? parsedScore
          : null;

      byCode.set(code, {
        ...existing,
        status: existing.status === "bye" ? "bye" : eventStatus,
        score: existing.status === "bye" ? null : score,
        source: "espn",
        event_id: eventId,
        kickoff_at: kickoffAt,
        status_detail: existing.status === "bye" ? "Official NFL bye" : detail,
        synced_at: fetchedAt,
      });
    });
  });

  const scores = NFL_2026_TEAMS.map(
    (team) => byCode.get(team.code) ?? rows[0],
  );
  const summary: CloudNflSyncSummary = {
    provider: "ESPN NFL scoreboard",
    week,
    fetched_at: fetchedAt,
    event_count: events.length,
    team_count: scores.filter((row) => row.status !== "bye").length,
    final_team_count: scores.filter((row) => row.status === "final").length,
    live_team_count: scores.filter((row) => row.status === "live").length,
    scheduled_team_count: scores.filter(
      (row) => row.status === "not_started",
    ).length,
    exception_team_count: scores.filter(
      (row) => row.status === "postponed" || row.status === "canceled",
    ).length,
  };

  return { scores, summary };
}
