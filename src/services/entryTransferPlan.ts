import { entryOwner } from "./entryOwnership";

// Verified against the production roster and backup on 2026-09-09.
export const ERIN_ENTRY = "pQgntfhazJTupHsRu7ifYCKDHUZ2";
export const MITCH_OWNER = "aVLCNGp2amUyiyVqFR6VkGmHAFP2";
export const TRANSFER_ID = "2026-erin-19-to-mitch2-v1";
export type TransferRecords = Record<string, Record<string, unknown>>;
export const TRANSFER_PATHS = [
  "poolConfig/main", "claims/19", "claims/24",
  `userClaims/${ERIN_ENTRY}`, `userClaims/${MITCH_OWNER}`,
  `users/${ERIN_ENTRY}`, `users/${MITCH_OWNER}`,
  "privateSchedules/19", "privateSchedules/24",
  `payments/${ERIN_ENTRY}`, `payments/${MITCH_OWNER}`,
] as const;

export function validateTransfer(records: TransferRecords): void {
  const require = (ok: unknown, message: string) => { if (!ok) throw new Error(message); };
  TRANSFER_PATHS.forEach((path) => require(records[path], `Missing required record: ${path}`));
  const config = records["poolConfig/main"];
  require(config.season === 2026 && config.seasonLaunched === true
    && config.schedulesLocked === true && config.numberSelectionOpen === false
    && config.scheduleId === "33P-2026-AEDA92D101", "The verified live 2026 season has changed.");
  for (const [id, line, name] of [
    [ERIN_ENTRY, "19", "Erin"],
    [MITCH_OWNER, "24", "Mitch"],
  ]) {
    const claim = records[`claims/${line}`];
    const index = records[`userClaims/${id}`];
    const user = records[`users/${id}`];
    const schedule = records[`privateSchedules/${line}`];
    const payment = records[`payments/${id}`];
    require(claim.uid === id && claim.lineId === line && claim.playerName === name
      && entryOwner(claim) === id, `Unexpected ${name} claim identity or owner.`);
    require(index.uid === id && index.lineId === line && index.playerName === name
      && entryOwner(index) === id && index.claimedAt === claim.claimedAt,
    `The ${name} claim index does not match.`);
    require(user.uid === id && user.displayName === name
      && (id !== MITCH_OWNER || user.email === "bball1112@msn.com"), `The ${name} account/email does not match.`);
    require(payment.uid === id && payment.scheduleNumber === Number(line), `The ${name} ledger does not match.`);
    const assignments = schedule.assignments;
    require(schedule.scheduleId === config.scheduleId && Array.isArray(assignments)
      && assignments.length === 18 && new Set(assignments.map((a) => a.week)).size === 18
      && assignments.every((a) => Number.isInteger(a.week) && a.week >= 1 && a.week <= 18),
    `The ${name} schedule is incomplete or belongs to a different pull.`);
  }
}

export function transferUpdates() {
  const patch = { playerName: "Mitch2", ownerUid: MITCH_OWNER };
  return { "claims/19": patch, [`userClaims/${ERIN_ENTRY}`]: patch };
}

export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value)
    .sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(",")}}`;
  return JSON.stringify(value);
}
