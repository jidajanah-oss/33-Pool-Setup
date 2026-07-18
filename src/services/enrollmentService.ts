import type {
  GeneratedScheduleSet,
  LocalPlayerProfile,
  PlayerClaim,
} from "../types/pool";

export const SCHEDULE_STORAGE_KEY = "33-pool-2026-anonymous-schedule-set";
const CLAIMS_STORAGE_KEY = "33-pool-2026-number-claims-v1";
const PLAYER_STORAGE_KEY = "33-pool-2026-local-player-v1";
export const ENROLLMENT_UPDATED_EVENT = "33-pool-enrollment-updated";

function createId(): string {
  return typeof globalThis.crypto?.randomUUID === "function"
    ? globalThis.crypto.randomUUID()
    : `player-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function notifyEnrollmentChanged(): void {
  window.dispatchEvent(new Event(ENROLLMENT_UPDATED_EVENT));
}

export function readScheduleSet(): GeneratedScheduleSet | null {
  try {
    const raw = localStorage.getItem(SCHEDULE_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as GeneratedScheduleSet) : null;
  } catch {
    return null;
  }
}

export function readClaims(): PlayerClaim[] {
  try {
    const raw = localStorage.getItem(CLAIMS_STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as PlayerClaim[]) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function readLocalPlayer(): LocalPlayerProfile | null {
  try {
    const raw = localStorage.getItem(PLAYER_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as LocalPlayerProfile) : null;
  } catch {
    return null;
  }
}

export function saveLocalPlayerName(name: string): LocalPlayerProfile {
  const cleanName = name.trim().replace(/\s+/g, " ");
  if (cleanName.length < 2) throw new Error("Enter the player's name first.");
  if (cleanName.length > 40) throw new Error("Player names are limited to 40 characters.");

  const existing = readLocalPlayer();
  const profile: LocalPlayerProfile = {
    id: existing?.id ?? createId(),
    name: cleanName,
    createdAt: existing?.createdAt ?? new Date().toISOString(),
  };
  localStorage.setItem(PLAYER_STORAGE_KEY, JSON.stringify(profile));

  const claims = readClaims().map((claim) =>
    claim.playerId === profile.id ? { ...claim, playerName: cleanName } : claim,
  );
  localStorage.setItem(CLAIMS_STORAGE_KEY, JSON.stringify(claims));
  notifyEnrollmentChanged();
  return profile;
}

export function claimScheduleNumber(profile: LocalPlayerProfile, scheduleNumber: number): void {
  const schedule = readScheduleSet();
  if (!schedule?.lockedAt || !schedule.validation.isValid) {
    throw new Error("The commissioner must generate, validate, and lock the schedules first.");
  }
  if (!schedule.lines.some((line) => line.lineNumber === scheduleNumber)) {
    throw new Error("That schedule number does not exist.");
  }

  const claims = readClaims();
  const existing = claims.find((claim) => claim.playerId === profile.id);
  if (existing) throw new Error(`This player already owns Schedule #${existing.scheduleNumber}.`);
  if (claims.some((claim) => claim.scheduleNumber === scheduleNumber)) {
    throw new Error("That number was just claimed. Choose another available number.");
  }

  claims.push({
    playerId: profile.id,
    playerName: profile.name,
    scheduleNumber,
    claimedAt: new Date().toISOString(),
  });
  claims.sort((a, b) => a.scheduleNumber - b.scheduleNumber);
  localStorage.setItem(CLAIMS_STORAGE_KEY, JSON.stringify(claims));
  notifyEnrollmentChanged();
}

export function releaseScheduleNumber(scheduleNumber: number): void {
  const claims = readClaims().filter((claim) => claim.scheduleNumber !== scheduleNumber);
  localStorage.setItem(CLAIMS_STORAGE_KEY, JSON.stringify(claims));
  notifyEnrollmentChanged();
}

export function clearLocalClaims(): void {
  localStorage.setItem(CLAIMS_STORAGE_KEY, "[]");
  notifyEnrollmentChanged();
}
