import { initializeApp } from "firebase-admin/app";
import { getAuth as getAdminAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { defineSecret } from "firebase-functions/params";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import {
  createHmac,
  randomInt,
  timingSafeEqual,
} from "node:crypto";

initializeApp();

const REGION = "us-east1";
const PRIMARY_UID = "jytf6FyhvoSnMEOsaV6OyWPNXfv2";
const PRIMARY_EMAIL = "jidajanah@gmail.com";
const ESPN_URL =
  "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard";

const BREVO_API_KEY = defineSecret("BREVO_API_KEY");
const BREVO_SENDER_EMAIL = defineSecret("BREVO_SENDER_EMAIL");
const OTP_PEPPER = defineSecret("OTP_PEPPER");

const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_RESEND_WAIT_MS = 60 * 1000;
const OTP_EMAIL_LIMIT_PER_HOUR = 5;
const OTP_IP_LIMIT_PER_HOUR = 20;
const OTP_MAX_ATTEMPTS = 5;

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


interface StoredOtpChallenge {
  email?: unknown;
  displayName?: unknown;
  codeHash?: unknown;
  expiresAtMs?: unknown;
  sentAtMs?: unknown;
  attempts?: unknown;
  requestCount?: unknown;
  windowStartedAtMs?: unknown;
  consumedAtMs?: unknown;
}

function cleanOtpEmail(value: unknown): string {
  const email = text(value).trim().toLowerCase();

  if (
    email.length < 5 ||
    email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  ) {
    throw new HttpsError(
      "invalid-argument",
      "Enter a valid email address.",
    );
  }

  return email;
}

function cleanOtpName(value: unknown): string {
  const name = text(value).trim().replace(/\s+/g, " ");

  if (name.length < 2 || name.length > 40) {
    throw new HttpsError(
      "invalid-argument",
      "Enter the player's name.",
    );
  }

  return name;
}

function numberOrZero(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : 0;
}

function hmacHex(secret: string, value: string): string {
  return createHmac("sha256", secret)
    .update(value)
    .digest("hex");
}

function otpChallengeId(email: string): string {
  return hmacHex(OTP_PEPPER.value(), `email:${email}`);
}

function otpDigest(
  email: string,
  code: string,
  expiresAtMs: number,
): string {
  return hmacHex(
    OTP_PEPPER.value(),
    `${email}|${code}|${expiresAtMs}`,
  );
}

function safeHashMatches(
  suppliedHash: string,
  storedHash: string,
): boolean {
  try {
    const supplied = Buffer.from(suppliedHash, "hex");
    const stored = Buffer.from(storedHash, "hex");

    return (
      supplied.length === stored.length &&
      supplied.length > 0 &&
      timingSafeEqual(supplied, stored)
    );
  } catch {
    return false;
  }
}

function maskEmail(email: string): string {
  const [local, domain] = email.split("@");

  if (!local || !domain) {
    return email;
  }

  const visible =
    local.length <= 2
      ? local.slice(0, 1)
      : local.slice(0, 2);

  return `${visible}${"*".repeat(
    Math.max(2, local.length - visible.length),
  )}@${domain}`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function sendBrevoCode(input: {
  email: string;
  displayName: string;
  code: string;
  purpose: "sign_in" | "invite";
}): Promise<void> {
  const senderEmail = BREVO_SENDER_EMAIL.value().trim();

  if (!senderEmail) {
    throw new Error(
      "The verified Brevo sender email is not configured.",
    );
  }

  const safeName = escapeHtml(input.displayName);
  const safeCode = escapeHtml(input.code);
  const invitationCopy =
    input.purpose === "invite"
      ? `<p>You were invited to join the 33 Football Pool.</p>
         <p>Open 33 Pool, enter this email, choose
         <strong>I Already Have a Code</strong>, and enter the code below.</p>`
      : `<p>Enter this code inside the 33 Pool app to finish signing in.</p>`;

  const response = await fetch(
    "https://api.brevo.com/v3/smtp/email",
    {
      method: "POST",
      headers: {
        accept: "application/json",
        "api-key": BREVO_API_KEY.value(),
        "content-type": "application/json",
      },
      body: JSON.stringify({
        sender: {
          name: "33 Football Pool",
          email: senderEmail,
        },
        to: [
          {
            name: input.displayName,
            email: input.email,
          },
        ],
        subject: "Your 33 Football Pool sign-in code",
        htmlContent: `
          <div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;padding:24px;color:#061f42;">
            <h1 style="margin:0 0 16px;">33 Football Pool</h1>
            <p>Hello ${safeName},</p>
            ${invitationCopy}
            <div style="margin:24px 0;padding:18px;border-radius:12px;background:#061f42;color:#fff;text-align:center;">
              <div style="font-size:13px;text-transform:uppercase;letter-spacing:1px;">Verification code</div>
              <div style="font-size:36px;font-weight:800;letter-spacing:8px;margin-top:8px;">${safeCode}</div>
            </div>
            <p>This code expires in 10 minutes and can be used only once.</p>
            <p>Do not share this code with anyone.</p>
          </div>
        `,
        textContent:
          `Hello ${input.displayName},\n\n` +
          (input.purpose === "invite"
            ? "You were invited to join the 33 Football Pool. Open 33 Pool, enter this email, choose I Already Have a Code, and enter the code below.\n\n"
            : "Enter this code inside the 33 Pool app to finish signing in.\n\n") +
          `Verification code: ${input.code}\n\n` +
          "This code expires in 10 minutes and can be used only once.",
      }),
    },
  );

  if (!response.ok) {
    const detail = await response.text().catch(() => "");

    logger.error("Brevo OTP delivery failed", {
      status: response.status,
      detail: detail.slice(0, 500),
    });

    throw new Error(
      `Brevo rejected the verification email with HTTP ${response.status}.`,
    );
  }
}

export const request33PoolOtp = onCall(
  {
    region: REGION,
    memory: "256MiB",
    timeoutSeconds: 60,
    cors: true,
    secrets: [
      BREVO_API_KEY,
      BREVO_SENDER_EMAIL,
      OTP_PEPPER,
    ],
  },
  async (request) => {
    const email = cleanOtpEmail(request.data?.email);
    const displayName = cleanOtpName(
      request.data?.displayName,
    );
    const purpose =
      request.data?.purpose === "invite"
        ? "invite"
        : "sign_in";

    if (purpose === "invite") {
      if (!request.auth) {
        throw new HttpsError(
          "unauthenticated",
          "Commissioner sign-in is required to send invitations.",
        );
      }

      const requesterEmail = text(
        request.auth.token.email,
      );

      if (
        !(await isCommissioner(
          request.auth.uid,
          requesterEmail,
        ))
      ) {
        throw new HttpsError(
          "permission-denied",
          "Commissioner access is required to send invitations.",
        );
      }
    }

    const now = Date.now();
    const expiresAtMs = now + OTP_TTL_MS;
    const code = String(
      randomInt(100000, 1000000),
    );
    const codeHash = otpDigest(
      email,
      code,
      expiresAtMs,
    );
    const db = getFirestore();
    const challengeRef = db.doc(
      `_otpChallenges/${otpChallengeId(email)}`,
    );
    const rawIp =
      request.rawRequest.ip ||
      text(
        request.rawRequest.headers["x-forwarded-for"],
      ).split(",")[0]?.trim() ||
      "unknown";
    const ipRef = db.doc(
      `_otpRateLimits/${hmacHex(
        OTP_PEPPER.value(),
        `ip:${rawIp}`,
      )}`,
    );

    await db.runTransaction(async (transaction) => {
      const [challengeSnapshot, ipSnapshot] =
        await Promise.all([
          transaction.get(challengeRef),
          transaction.get(ipRef),
        ]);
      const existing = challengeSnapshot.data() as
        | StoredOtpChallenge
        | undefined;
      const lastSentAtMs = numberOrZero(
        existing?.sentAtMs,
      );

      if (
        lastSentAtMs > 0 &&
        now - lastSentAtMs < OTP_RESEND_WAIT_MS
      ) {
        throw new HttpsError(
          "resource-exhausted",
          "Please wait one minute before requesting another code.",
        );
      }

      const priorWindowStart = numberOrZero(
        existing?.windowStartedAtMs,
      );
      const sameEmailWindow =
        priorWindowStart > 0 &&
        now - priorWindowStart < 60 * 60 * 1000;
      const emailRequestCount = sameEmailWindow
        ? numberOrZero(existing?.requestCount)
        : 0;

      if (
        emailRequestCount >= OTP_EMAIL_LIMIT_PER_HOUR
      ) {
        throw new HttpsError(
          "resource-exhausted",
          "Too many codes were requested for this email. Try again later.",
        );
      }

      const ipData = ipSnapshot.data();
      const ipWindowStart = numberOrZero(
        ipData?.windowStartedAtMs,
      );
      const sameIpWindow =
        ipWindowStart > 0 &&
        now - ipWindowStart < 60 * 60 * 1000;
      const ipRequestCount = sameIpWindow
        ? numberOrZero(ipData?.requestCount)
        : 0;

      if (ipRequestCount >= OTP_IP_LIMIT_PER_HOUR) {
        throw new HttpsError(
          "resource-exhausted",
          "Too many sign-in requests were made from this connection. Try again later.",
        );
      }

      transaction.set(challengeRef, {
        email,
        displayName,
        codeHash,
        expiresAtMs,
        sentAtMs: now,
        attempts: 0,
        requestCount: emailRequestCount + 1,
        windowStartedAtMs: sameEmailWindow
          ? priorWindowStart
          : now,
        consumedAtMs: null,
        purpose,
      });

      transaction.set(ipRef, {
        requestCount: ipRequestCount + 1,
        windowStartedAtMs: sameIpWindow
          ? ipWindowStart
          : now,
        lastRequestAtMs: now,
      });
    });

    try {
      await sendBrevoCode({
        email,
        displayName,
        code,
        purpose,
      });
    } catch (error) {
      await challengeRef.delete().catch(() => undefined);

      throw new HttpsError(
        "internal",
        error instanceof Error
          ? error.message
          : "The verification email could not be sent.",
      );
    }

    return {
      maskedEmail: maskEmail(email),
      expiresInSeconds: OTP_TTL_MS / 1000,
    };
  },
);

export const verify33PoolOtp = onCall(
  {
    region: REGION,
    memory: "256MiB",
    timeoutSeconds: 60,
    cors: true,
    secrets: [OTP_PEPPER],
  },
  async (request) => {
    const email = cleanOtpEmail(request.data?.email);
    const code = text(request.data?.code)
      .replace(/\D/g, "")
      .slice(0, 6);

    if (!/^\d{6}$/.test(code)) {
      throw new HttpsError(
        "invalid-argument",
        "Enter the complete 6-digit code.",
      );
    }

    const db = getFirestore();
    const challengeRef = db.doc(
      `_otpChallenges/${otpChallengeId(email)}`,
    );
    const snapshot = await challengeRef.get();

    if (!snapshot.exists) {
      throw new HttpsError(
        "not-found",
        "That code is invalid or has expired. Request a new code.",
      );
    }

    const challenge =
      snapshot.data() as StoredOtpChallenge;
    const expiresAtMs = numberOrZero(
      challenge.expiresAtMs,
    );
    const attempts = numberOrZero(
      challenge.attempts,
    );
    const storedHash = text(challenge.codeHash);
    const suppliedHash = otpDigest(
      email,
      code,
      expiresAtMs,
    );
    const now = Date.now();

    if (
      numberOrZero(challenge.consumedAtMs) > 0 ||
      expiresAtMs <= now
    ) {
      await challengeRef.delete().catch(() => undefined);

      throw new HttpsError(
        "deadline-exceeded",
        "That code is invalid or has expired. Request a new code.",
      );
    }

    if (attempts >= OTP_MAX_ATTEMPTS) {
      await challengeRef.delete().catch(() => undefined);

      throw new HttpsError(
        "resource-exhausted",
        "Too many incorrect attempts. Request a new code.",
      );
    }

    if (!safeHashMatches(suppliedHash, storedHash)) {
      await challengeRef.update({
        attempts: attempts + 1,
        lastAttemptAtMs: now,
      });

      throw new HttpsError(
        "invalid-argument",
        "That code is incorrect. Check the email and try again.",
      );
    }

    await db.runTransaction(async (transaction) => {
      const freshSnapshot =
        await transaction.get(challengeRef);

      if (!freshSnapshot.exists) {
        throw new HttpsError(
          "not-found",
          "That code is invalid or has expired.",
        );
      }

      const fresh =
        freshSnapshot.data() as StoredOtpChallenge;

      if (
        numberOrZero(fresh.consumedAtMs) > 0 ||
        numberOrZero(fresh.expiresAtMs) <= Date.now() ||
        text(fresh.codeHash) !== storedHash
      ) {
        throw new HttpsError(
          "failed-precondition",
          "That code can no longer be used.",
        );
      }

      transaction.update(challengeRef, {
        consumedAtMs: Date.now(),
      });
    });

    const adminAuth = getAdminAuth();
    const displayName = text(
      challenge.displayName,
    ).trim();
    let userRecord;

    try {
      userRecord = await adminAuth.getUserByEmail(email);

      const update: {
        emailVerified?: boolean;
        displayName?: string;
      } = {};

      if (!userRecord.emailVerified) {
        update.emailVerified = true;
      }

      if (!userRecord.displayName && displayName) {
        update.displayName = displayName;
      }

      if (Object.keys(update).length > 0) {
        userRecord = await adminAuth.updateUser(
          userRecord.uid,
          update,
        );
      }
    } catch (error) {
      const errorCode =
        typeof error === "object" &&
        error !== null &&
        "code" in error
          ? String(
              (error as { code?: unknown }).code,
            )
          : "";

      if (errorCode !== "auth/user-not-found") {
        logger.error("Firebase OTP user lookup failed", error);

        throw new HttpsError(
          "internal",
          "Firebase could not complete the sign-in.",
        );
      }

      userRecord = await adminAuth.createUser({
        email,
        emailVerified: true,
        displayName: displayName || undefined,
      });
    }

    const customToken =
      await adminAuth.createCustomToken(userRecord.uid);

    await challengeRef.delete().catch(() => undefined);

    return {
      customToken,
      email,
    };
  },
);

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
