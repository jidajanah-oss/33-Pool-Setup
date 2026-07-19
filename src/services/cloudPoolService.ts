import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  runTransaction,
  setDoc,
  updateDoc,
  writeBatch,
} from "firebase/firestore";
import { requireFirebaseAuth, requireFirestore } from "../lib/firebase";
import {
  getCloudRoleForUid,
  requireCloudCommissioner,
  requireCloudPrimary,
} from "./cloudRoleService";
import type {
  CloudClaim,
  CloudNumberSlot,
  CloudPoolStatus,
  CloudProfile,
  CloudRole,
  CloudWeeklyRow,
} from "../types/cloud";
import type {
  GeneratedScheduleAssignment,
  GeneratedScheduleSet,
} from "../types/pool";

interface StoredScheduleLine {
  lineNumber: number;
  scheduleId: string;
  generatedAt: string;
  lockedAt: string;
  assignments: GeneratedScheduleAssignment[];
}

interface PublicWeekRow {
  lineId: string;
  teamCode: string;
  teamName: string;
  isBye: boolean;
}

export interface CloudPullResetResult {
  archive_id: string;
  new_schedule_id: string;
  previous_schedule_id: string | null;
  previous_claim_count: number;
  reset_at: string;
}

export interface CloudSeasonLaunchResult {
  launch_id: string;
  season: number;
  week: number;
  schedule_id: string;
  claim_count: number;
  nfl_team_count: number;
  launched_at: string;
}

function requireUserId(): string {
  const user = requireFirebaseAuth().currentUser;

  if (!user) {
    throw new Error("Sign in to Firebase first.");
  }

  return user.uid;
}

function asIsoString(value: unknown, fallback = ""): string {
  if (typeof value === "string") {
    return value;
  }

  if (
    value &&
    typeof value === "object" &&
    "toDate" in value &&
    typeof value.toDate === "function"
  ) {
    return value.toDate().toISOString();
  }

  return fallback;
}

async function getCurrentRole(): Promise<CloudRole> {
  return getCloudRoleForUid(requireUserId());
}

export async function fetchCloudProfile(
  userId: string,
): Promise<CloudProfile> {
  const db = requireFirestore();
  const [profileSnapshot, role] = await Promise.all([
    getDoc(doc(db, "users", userId)),
    getCloudRoleForUid(userId),
  ]);

  if (!profileSnapshot.exists()) {
    throw new Error("The Firebase player profile does not exist.");
  }

  const data = profileSnapshot.data();

  return {
    id: userId,
    display_name:
      typeof data.displayName === "string" ? data.displayName : "Player",
    role,
    created_at: asIsoString(data.createdAt),
    updated_at: asIsoString(data.updatedAt),
  };
}

export async function fetchPoolStatus(): Promise<CloudPoolStatus> {
  const db = requireFirestore();
  const snapshot = await getDoc(doc(db, "poolConfig", "main"));

  if (!snapshot.exists()) {
    return {
      id: 1,
      pool_name: "33 Pool Setup",
      season: 2026,
      current_week: 1,
      enrollment_open: false,
      schedule_locked: false,
      schedule_id: null,
      schedule_generated_at: null,
      schedule_locked_at: null,
      season_launched: false,
      season_launched_at: null,
      season_launched_by_name: null,
      season_launch_id: null,
      week_one_locked: false,
    };
  }

  const data = snapshot.data();

  return {
    id: 1,
    pool_name:
      typeof data.poolName === "string" ? data.poolName : "33 Pool Setup",
    season: typeof data.season === "number" ? data.season : 2026,
    current_week:
      typeof data.currentWeek === "number" ? data.currentWeek : 1,
    enrollment_open: data.numberSelectionOpen === true,
    schedule_locked: data.schedulesLocked === true,
    schedule_id:
      typeof data.scheduleId === "string" ? data.scheduleId : null,
    schedule_generated_at:
      typeof data.scheduleGeneratedAt === "string"
        ? data.scheduleGeneratedAt
        : null,
    schedule_locked_at:
      typeof data.scheduleLockedAt === "string"
        ? data.scheduleLockedAt
        : null,
    season_launched: data.seasonLaunched === true,
    season_launched_at:
      typeof data.seasonLaunchedAt === "string"
        ? data.seasonLaunchedAt
        : null,
    season_launched_by_name:
      typeof data.seasonLaunchedByName === "string"
        ? data.seasonLaunchedByName
        : null,
    season_launch_id:
      typeof data.seasonLaunchId === "string"
        ? data.seasonLaunchId
        : null,
    week_one_locked: data.weekOneLocked === true,
  };
}

export async function fetchCommissionerExists(): Promise<boolean> {
  return (await getCurrentRole()) !== "player";
}

export async function fetchNumberBoard(): Promise<CloudNumberSlot[]> {
  const db = requireFirestore();
  const uid = requireUserId();
  const snapshots = await getDocs(collection(db, "claims"));
  const claimsByNumber = new Map<
    number,
    { uid: string; playerName: string }
  >();

  snapshots.forEach((snapshot) => {
    const lineNumber = Number(snapshot.id);
    const data = snapshot.data();

    if (Number.isInteger(lineNumber) && lineNumber >= 1 && lineNumber <= 32) {
      claimsByNumber.set(lineNumber, {
        uid: typeof data.uid === "string" ? data.uid : "",
        playerName:
          typeof data.playerName === "string" ? data.playerName : "Player",
      });
    }
  });

  return Array.from({ length: 32 }, (_, index) => {
    const scheduleNumber = index + 1;
    const claim = claimsByNumber.get(scheduleNumber);

    return {
      schedule_number: scheduleNumber,
      player_name: claim?.playerName ?? null,
      claimed: Boolean(claim),
      mine: claim?.uid === uid,
    };
  });
}

export async function fetchMyClaim(): Promise<CloudClaim | null> {
  const db = requireFirestore();
  const uid = requireUserId();
  const snapshot = await getDoc(doc(db, "userClaims", uid));

  if (!snapshot.exists()) {
    return null;
  }

  const data = snapshot.data();
  const scheduleNumber = Number(data.lineId);

  if (!Number.isInteger(scheduleNumber)) {
    throw new Error("The Firebase schedule claim is invalid.");
  }

  return {
    schedule_number: scheduleNumber,
    claimed_at: asIsoString(data.claimedAt),
  };
}

export async function fetchMySchedule(
  scheduleNumber: number,
): Promise<GeneratedScheduleAssignment[]> {
  const db = requireFirestore();
  const snapshot = await getDoc(
    doc(db, "privateSchedules", String(scheduleNumber)),
  );

  if (!snapshot.exists()) {
    return [];
  }

  const data = snapshot.data();
  const assignments = Array.isArray(data.assignments)
    ? (data.assignments as GeneratedScheduleAssignment[])
    : [];

  return [...assignments].sort((a, b) => a.week - b.week);
}

export async function fetchWeeklyBoard(
  week: number,
): Promise<CloudWeeklyRow[]> {
  const db = requireFirestore();
  const uid = requireUserId();
  const role = await getCurrentRole();
  const isCommissioner = role !== "player";

  const [claimSnapshots, ownClaimSnapshot, publicWeekSnapshot] =
    await Promise.all([
      getDocs(collection(db, "claims")),
      getDoc(doc(db, "userClaims", uid)),
      getDoc(doc(db, "weeklyPublic", String(week))),
    ]);

  const claims = new Map<
    number,
    { uid: string; playerName: string }
  >();

  claimSnapshots.forEach((snapshot) => {
    const lineNumber = Number(snapshot.id);
    const data = snapshot.data();

    if (Number.isInteger(lineNumber)) {
      claims.set(lineNumber, {
        uid: typeof data.uid === "string" ? data.uid : "",
        playerName:
          typeof data.playerName === "string" ? data.playerName : "Player",
      });
    }
  });

  const ownLineId = ownClaimSnapshot.exists()
    ? Number(ownClaimSnapshot.data().lineId)
    : null;

  const assignmentsByLine = new Map<number, GeneratedScheduleAssignment>();

  if (isCommissioner) {
    const scheduleSnapshots = await getDocs(
      collection(db, "privateSchedules"),
    );

    scheduleSnapshots.forEach((snapshot) => {
      const lineNumber = Number(snapshot.id);
      const data = snapshot.data() as StoredScheduleLine;
      const assignment = data.assignments?.find((item) => item.week === week);

      if (assignment) {
        assignmentsByLine.set(lineNumber, assignment);
      }
    });
  } else {
    if (ownLineId !== null && Number.isInteger(ownLineId)) {
      const ownSchedule = await getDoc(
        doc(db, "privateSchedules", String(ownLineId)),
      );

      if (ownSchedule.exists()) {
        const data = ownSchedule.data() as StoredScheduleLine;
        const assignment = data.assignments?.find(
          (item) => item.week === week,
        );

        if (assignment) {
          assignmentsByLine.set(ownLineId, assignment);
        }
      }
    }

    if (publicWeekSnapshot.exists()) {
      const publicRows = Array.isArray(publicWeekSnapshot.data().rows)
        ? (publicWeekSnapshot.data().rows as PublicWeekRow[])
        : [];

      publicRows.forEach((row) => {
        const lineNumber = Number(row.lineId);

        if (Number.isInteger(lineNumber) && claims.has(lineNumber)) {
          assignmentsByLine.set(lineNumber, {
            week,
            teamCode: row.teamCode,
            teamName: row.teamName,
            isBye: row.isBye,
          });
        }
      });
    }
  }

  return Array.from({ length: 32 }, (_, index) => {
    const scheduleNumber = index + 1;
    const claim = claims.get(scheduleNumber);
    const assignment = assignmentsByLine.get(scheduleNumber);

    return {
      schedule_number: scheduleNumber,
      player_name: claim?.playerName ?? null,
      team_code: assignment?.teamCode ?? null,
      team_name: assignment?.teamName ?? null,
      is_bye: assignment?.isBye ?? null,
      mine: scheduleNumber === ownLineId,
    };
  });
}

export async function claimCloudNumber(
  scheduleNumber: number,
): Promise<void> {
  const db = requireFirestore();
  const auth = requireFirebaseAuth();
  const user = auth.currentUser;

  if (!user) {
    throw new Error("Sign in before choosing a number.");
  }

  const lineId = String(scheduleNumber);
  const configRef = doc(db, "poolConfig", "main");
  const claimRef = doc(db, "claims", lineId);
  const userClaimRef = doc(db, "userClaims", user.uid);
  const userRef = doc(db, "users", user.uid);

  await runTransaction(db, async (transaction) => {
    const [configSnapshot, claimSnapshot, userClaimSnapshot, userSnapshot] =
      await Promise.all([
        transaction.get(configRef),
        transaction.get(claimRef),
        transaction.get(userClaimRef),
        transaction.get(userRef),
      ]);

    if (
      !configSnapshot.exists() ||
      configSnapshot.data().schedulesLocked !== true ||
      configSnapshot.data().numberSelectionOpen !== true
    ) {
      throw new Error("Number selection is not open.");
    }

    if (claimSnapshot.exists()) {
      throw new Error(
        "That number was already claimed. Choose another available number.",
      );
    }

    if (userClaimSnapshot.exists()) {
      throw new Error(
        `This account already owns Schedule #${userClaimSnapshot.data().lineId}.`,
      );
    }

    if (!userSnapshot.exists()) {
      throw new Error("The Firebase player profile is missing.");
    }

    const playerName = userSnapshot.data().displayName;

    if (typeof playerName !== "string" || playerName.trim().length < 2) {
      throw new Error("Enter the player's name before choosing a number.");
    }

    const claimedAt = new Date().toISOString();
    const claimData = {
      uid: user.uid,
      playerName,
      lineId,
      claimedAt,
    };

    transaction.set(claimRef, claimData);
    transaction.set(userClaimRef, claimData);
  });
}

export async function updateCloudDisplayName(
  displayName: string,
): Promise<void> {
  const db = requireFirestore();
  const uid = requireUserId();
  const cleanName = displayName.trim().replace(/\s+/g, " ");

  if (cleanName.length < 2 || cleanName.length > 40) {
    throw new Error("Enter the player's name.");
  }

  const [profileSnapshot, claimSnapshot] = await Promise.all([
    getDoc(doc(db, "users", uid)),
    getDoc(doc(db, "userClaims", uid)),
  ]);

  if (!profileSnapshot.exists()) {
    throw new Error("The Firebase player profile is missing.");
  }

  if (claimSnapshot.exists()) {
    throw new Error(
      "A claimed player name can be changed only by the commissioner.",
    );
  }

  const current = profileSnapshot.data();

  await setDoc(
    doc(db, "users", uid),
    {
      uid,
      displayName: cleanName,
      email: typeof current.email === "string" ? current.email : "",
      createdAt: asIsoString(current.createdAt, new Date().toISOString()),
      updatedAt: new Date().toISOString(),
    },
    { merge: false },
  );
}

export async function bootstrapPrimaryCommissioner(): Promise<void> {
  throw new Error(
    "For secure Firebase setup, create the Primary Commissioner admin document once in the Firebase console.",
  );
}

export async function publishCloudSchedule(
  schedule: GeneratedScheduleSet,
): Promise<void> {
  const db = requireFirestore();
  const role = await getCurrentRole();

  if (role === "player") {
    throw new Error("Primary Commissioner access is required.");
  }

  if (!schedule.lockedAt || !schedule.validation.isValid) {
    throw new Error(
      "Generate, validate, and lock the complete schedule before publishing.",
    );
  }

  const batch = writeBatch(db);

  schedule.lines.forEach((line) => {
    const storedLine: StoredScheduleLine = {
      lineNumber: line.lineNumber,
      scheduleId: schedule.id,
      generatedAt: schedule.generatedAt,
      lockedAt: schedule.lockedAt ?? new Date().toISOString(),
      assignments: line.assignments,
    };

    batch.set(
      doc(db, "privateSchedules", String(line.lineNumber)),
      storedLine,
    );
  });

  const weekOneRows: PublicWeekRow[] = schedule.lines.map((line) => {
    const assignment = line.assignments.find((item) => item.week === 1);

    if (!assignment) {
      throw new Error(
        `Schedule #${line.lineNumber} is missing its Week 1 assignment.`,
      );
    }

    return {
      lineId: String(line.lineNumber),
      teamCode: assignment.teamCode,
      teamName: assignment.teamName,
      isBye: assignment.isBye,
    };
  });

  batch.set(doc(db, "weeklyPublic", "1"), {
    week: 1,
    publishedAt: new Date().toISOString(),
    rows: weekOneRows,
  });

  batch.set(doc(db, "poolConfig", "main"), {
    poolName: "33 Pool Setup",
    season: 2026,
    currentWeek: 1,
    numberSelectionOpen: true,
    schedulesLocked: true,
    scheduleId: schedule.id,
    scheduleGeneratedAt: schedule.generatedAt,
    scheduleLockedAt: schedule.lockedAt,
    seasonLaunched: false,
    seasonLaunchedAt: null,
    seasonLaunchedByUid: null,
    seasonLaunchedByEmail: null,
    seasonLaunchedByName: null,
    seasonLaunchId: null,
    weekOneLocked: false,
    updatedAt: new Date().toISOString(),
  });

  await batch.commit();
}

export async function setCloudEnrollmentOpen(
  open: boolean,
): Promise<void> {
  await requireCloudCommissioner();

  const db = requireFirestore();
  const configRef = doc(db, "poolConfig", "main");
  const configSnapshot = await getDoc(configRef);

  if (!configSnapshot.exists()) {
    throw new Error("The active pool configuration is missing.");
  }

  const config = configSnapshot.data();

  if (config.schedulesLocked !== true) {
    throw new Error(
      "Publish and lock the official schedule before changing number selection.",
    );
  }

  if (open && config.seasonLaunched === true) {
    throw new Error(
      "The 2026 season is already launched. Number selection is permanently closed.",
    );
  }

  await updateDoc(configRef, {
    numberSelectionOpen: open,
    updatedAt: new Date().toISOString(),
  });
}

export async function releaseCloudNumber(
  scheduleNumber: number,
): Promise<void> {
  await requireCloudCommissioner();

  const db = requireFirestore();
  const [configSnapshot, claimSnapshot] = await Promise.all([
    getDoc(doc(db, "poolConfig", "main")),
    getDoc(doc(db, "claims", String(scheduleNumber))),
  ]);
  const claimRef = doc(db, "claims", String(scheduleNumber));

  if (
    configSnapshot.exists() &&
    configSnapshot.data().seasonLaunched === true
  ) {
    throw new Error(
      "The 2026 season is launched. Schedule claims are frozen for Week 1.",
    );
  }

  if (!claimSnapshot.exists()) {
    return;
  }

  const uid = claimSnapshot.data().uid;

  if (typeof uid !== "string" || !uid) {
    await deleteDoc(claimRef);
    return;
  }

  const batch = writeBatch(db);
  batch.delete(claimRef);
  batch.delete(doc(db, "userClaims", uid));
  await batch.commit();
}

export async function launchCloud2026Season(
  confirmation: string,
): Promise<CloudSeasonLaunchResult> {
  await requireCloudPrimary();

  if (confirmation.trim().toUpperCase() !== "LAUNCH 2026") {
    throw new Error('Type "LAUNCH 2026" exactly to launch the season.');
  }

  const db = requireFirestore();
  const auth = requireFirebaseAuth();
  const user = auth.currentUser;

  if (!user) {
    throw new Error("Sign in to Firebase first.");
  }

  const configRef = doc(db, "poolConfig", "main");
  const launchRef = doc(db, "seasonLaunches", "2026");
  const auditRef = doc(collection(db, "audit"));

  const [
    configSnapshot,
    claimSnapshots,
    privateScheduleSnapshots,
    weekOneSnapshot,
    weekOneScoresSnapshot,
    weekOneResultSnapshot,
    commissionerTeamSnapshot,
    primaryProfileSnapshot,
  ] = await Promise.all([
    getDoc(configRef),
    getDocs(collection(db, "claims")),
    getDocs(collection(db, "privateSchedules")),
    getDoc(doc(db, "weeklyPublic", "1")),
    getDoc(doc(db, "teamScores", "1")),
    getDoc(doc(db, "weeklyResults", "1")),
    getDoc(doc(db, "commissionerTeam", "main")),
    getDoc(doc(db, "users", user.uid)),
  ]);

  if (!configSnapshot.exists()) {
    throw new Error("The active 2026 pool configuration is missing.");
  }

  const config = configSnapshot.data();
  const season =
    typeof config.season === "number" ? config.season : 2026;
  const currentWeek =
    typeof config.currentWeek === "number" ? config.currentWeek : 1;
  const scheduleId =
    typeof config.scheduleId === "string" ? config.scheduleId : "";

  if (season !== 2026) {
    throw new Error("Only the active 2026 season can be launched.");
  }

  if (config.seasonLaunched === true) {
    throw new Error("The 2026 season is already launched.");
  }

  if (currentWeek !== 1) {
    throw new Error("Season launch is available only before Week 1 begins.");
  }

  if (config.schedulesLocked !== true || !scheduleId) {
    throw new Error("Publish and lock the official schedule first.");
  }

  if (config.numberSelectionOpen === true) {
    throw new Error(
      "Close number selection before launching the season.",
    );
  }

  if (claimSnapshots.size !== 32) {
    throw new Error(
      `All 32 schedule numbers must be claimed. Current claims: ${claimSnapshots.size}.`,
    );
  }

  const claimUids = new Set<string>();

  claimSnapshots.forEach((snapshot) => {
    const uid = snapshot.data().uid;

    if (typeof uid === "string" && uid) {
      claimUids.add(uid);
    }
  });

  if (claimUids.size !== 32) {
    throw new Error(
      "Every schedule number must belong to a different signed-in player.",
    );
  }

  const validScheduleLines = privateScheduleSnapshots.docs.filter(
    (snapshot) => {
      const lineNumber = Number(snapshot.id);
      const data = snapshot.data();

      return (
        Number.isInteger(lineNumber) &&
        lineNumber >= 1 &&
        lineNumber <= 32 &&
        data.scheduleId === scheduleId &&
        Array.isArray(data.assignments) &&
        data.assignments.length === 18
      );
    },
  );

  if (validScheduleLines.length !== 32) {
    throw new Error(
      "Firebase does not contain 32 complete schedule lines for the active pull.",
    );
  }

  const publicRows =
    weekOneSnapshot.exists() &&
    Array.isArray(weekOneSnapshot.data().rows)
      ? weekOneSnapshot.data().rows
      : [];

  if (publicRows.length !== 32) {
    throw new Error(
      "The Week 1 public assignment board is incomplete.",
    );
  }

  const scoreRows: Array<Record<string, unknown>> =
    weekOneScoresSnapshot.exists() &&
    Array.isArray(weekOneScoresSnapshot.data().rows)
      ? (weekOneScoresSnapshot.data().rows as Array<
          Record<string, unknown>
        >)
      : [];
  const nflTeams = new Set(
    scoreRows
      .map((row) =>
        typeof row.teamCode === "string"
          ? row.teamCode
          : "",
      )
      .filter(Boolean),
  );

  if (nflTeams.size < 32) {
    throw new Error(
      `Week 1 NFL data is incomplete. Current teams loaded: ${nflTeams.size}/32.`,
    );
  }

  if (weekOneResultSnapshot.exists()) {
    throw new Error(
      "Week 1 already has an official result and cannot be relaunched.",
    );
  }

  if (!commissionerTeamSnapshot.exists()) {
    throw new Error("The commissioner team record is missing.");
  }

  const commissionerTeam = commissionerTeamSnapshot.data();

  if (
    typeof commissionerTeam.backup1Uid !== "string" ||
    !commissionerTeam.backup1Uid ||
    typeof commissionerTeam.backup2Uid !== "string" ||
    !commissionerTeam.backup2Uid
  ) {
    throw new Error(
      "Assign both Backup Commissioners before launching the season.",
    );
  }

  const primaryName =
    primaryProfileSnapshot.exists() &&
    typeof primaryProfileSnapshot.data().displayName === "string"
      ? primaryProfileSnapshot.data().displayName
      : "Jimbo";
  const launchedAt = new Date().toISOString();
  const launchId = `season-2026-${launchedAt
    .replaceAll(":", "")
    .replaceAll(".", "-")}`;

  await runTransaction(db, async (transaction) => {
    const [freshConfig, priorLaunch] = await Promise.all([
      transaction.get(configRef),
      transaction.get(launchRef),
    ]);

    if (!freshConfig.exists()) {
      throw new Error("The active 2026 pool configuration is missing.");
    }

    const fresh = freshConfig.data();

    if (fresh.seasonLaunched === true || priorLaunch.exists()) {
      throw new Error("The 2026 season is already launched.");
    }

    if (
      fresh.numberSelectionOpen === true ||
      fresh.scheduleId !== scheduleId ||
      fresh.currentWeek !== 1
    ) {
      throw new Error(
        "The pool changed during launch validation. Refresh and review the launch checklist.",
      );
    }

    transaction.update(configRef, {
      numberSelectionOpen: false,
      seasonLaunched: true,
      seasonLaunchedAt: launchedAt,
      seasonLaunchedByUid: user.uid,
      seasonLaunchedByEmail: user.email ?? "",
      seasonLaunchedByName: primaryName,
      seasonLaunchId: launchId,
      weekOneLocked: true,
      updatedAt: launchedAt,
    });

    transaction.set(launchRef, {
      launchId,
      season: 2026,
      week: 1,
      scheduleId,
      claimCount: claimSnapshots.size,
      uniquePlayerCount: claimUids.size,
      privateScheduleCount: validScheduleLines.length,
      publicAssignmentCount: publicRows.length,
      nflTeamCount: nflTeams.size,
      backup1Uid: commissionerTeam.backup1Uid,
      backup2Uid: commissionerTeam.backup2Uid,
      launchedAt,
      launchedByUid: user.uid,
      launchedByEmail: user.email ?? "",
      launchedByName: primaryName,
    });

    transaction.set(auditRef, {
      actionType: "season_2026_launched",
      launchId,
      season: 2026,
      week: 1,
      scheduleId,
      claimCount: claimSnapshots.size,
      nflTeamCount: nflTeams.size,
      commissionerUid: user.uid,
      commissionerEmail: user.email ?? "",
      commissionerName: primaryName,
      createdAt: launchedAt,
    });
  });

  return {
    launch_id: launchId,
    season: 2026,
    week: 1,
    schedule_id: scheduleId,
    claim_count: claimSnapshots.size,
    nfl_team_count: nflTeams.size,
    launched_at: launchedAt,
  };
}

export async function resetCloud2026Pull(
  schedule: GeneratedScheduleSet,
  confirmation: string,
): Promise<CloudPullResetResult> {
  await requireCloudPrimary();

  if (confirmation.trim() !== "RESET 2026") {
    throw new Error('Type "RESET 2026" exactly to confirm the new pull.');
  }

  if (
    schedule.season !== 2026 ||
    !schedule.lockedAt ||
    !schedule.validation.isValid ||
    schedule.lines.length !== 32
  ) {
    throw new Error(
      "The replacement schedule must be a complete, validated, locked 2026 schedule.",
    );
  }

  const db = requireFirestore();
  const auth = requireFirebaseAuth();
  const user = auth.currentUser;

  if (!user) {
    throw new Error("Sign in to Firebase first.");
  }

  const [
    configSnapshot,
    privateScheduleSnapshots,
    claimSnapshots,
    userClaimSnapshots,
    weeklyPublicSnapshots,
    teamScoreSnapshots,
    weeklyResultSnapshots,
    winnerSnapshots,
  ] = await Promise.all([
    getDoc(doc(db, "poolConfig", "main")),
    getDocs(collection(db, "privateSchedules")),
    getDocs(collection(db, "claims")),
    getDocs(collection(db, "userClaims")),
    getDocs(collection(db, "weeklyPublic")),
    getDocs(collection(db, "teamScores")),
    getDocs(collection(db, "weeklyResults")),
    getDocs(collection(db, "winners")),
  ]);

  if (!configSnapshot.exists()) {
    throw new Error("The active 2026 pool configuration is missing.");
  }

  const config = configSnapshot.data();
  const activeSeason =
    typeof config.season === "number" ? config.season : 2026;
  const currentWeek =
    typeof config.currentWeek === "number" ? config.currentWeek : 1;

  if (activeSeason !== 2026) {
    throw new Error("Only the active 2026 pull can be reset here.");
  }

  if (currentWeek !== 1) {
    throw new Error(
      "The 2026 pull can be reset only while the pool is still on Week 1.",
    );
  }

  if (config.seasonLaunched === true || config.weekOneLocked === true) {
    throw new Error(
      "The 2026 season has already launched. The preseason pull can no longer be reset.",
    );
  }

  if (!weeklyResultSnapshots.empty || !winnerSnapshots.empty) {
    throw new Error(
      "A week has already been finalized. The 2026 pull can no longer be reset.",
    );
  }

  const resetAt = new Date().toISOString();
  const archiveId = `pull-2026-${resetAt
    .replaceAll(":", "")
    .replaceAll(".", "-")}`;
  const previousScheduleId =
    typeof config.scheduleId === "string" ? config.scheduleId : null;
  const batch = writeBatch(db);
  let operationCount = 0;

  const set = (
    reference: Parameters<typeof batch.set>[0],
    value: Record<string, unknown>,
  ) => {
    batch.set(reference, value);
    operationCount += 1;
  };

  const remove = (reference: Parameters<typeof batch.delete>[0]) => {
    batch.delete(reference);
    operationCount += 1;
  };

  set(doc(db, "pullArchives", archiveId), {
    season: 2026,
    archiveType: "preseason_pull_reset",
    archivedAt: resetAt,
    archivedByUid: user.uid,
    archivedByEmail: user.email ?? "",
    previousScheduleId,
    previousClaimCount: claimSnapshots.size,
    newScheduleId: schedule.id,
    preservedCollections: [
      "users",
      "invites",
      "commissionerTeam",
      "payments",
      "paymentTransactions",
    ],
  });

  set(
    doc(db, "pullArchives", archiveId, "state", "poolConfig"),
    config,
  );

  privateScheduleSnapshots.forEach((snapshot) => {
    set(
      doc(
        db,
        "pullArchives",
        archiveId,
        "privateSchedules",
        snapshot.id,
      ),
      snapshot.data(),
    );

    const lineNumber = Number(snapshot.id);

    if (
      !Number.isInteger(lineNumber) ||
      lineNumber < 1 ||
      lineNumber > 32
    ) {
      remove(doc(db, "privateSchedules", snapshot.id));
    }
  });

  claimSnapshots.forEach((snapshot) => {
    set(
      doc(db, "pullArchives", archiveId, "claims", snapshot.id),
      snapshot.data(),
    );
    remove(doc(db, "claims", snapshot.id));
  });

  userClaimSnapshots.forEach((snapshot) => {
    set(
      doc(db, "pullArchives", archiveId, "userClaims", snapshot.id),
      snapshot.data(),
    );
    remove(doc(db, "userClaims", snapshot.id));
  });

  weeklyPublicSnapshots.forEach((snapshot) => {
    set(
      doc(
        db,
        "pullArchives",
        archiveId,
        "weeklyPublic",
        snapshot.id,
      ),
      snapshot.data(),
    );

    if (snapshot.id !== "1") {
      remove(doc(db, "weeklyPublic", snapshot.id));
    }
  });

  teamScoreSnapshots.forEach((snapshot) => {
    set(
      doc(db, "pullArchives", archiveId, "teamScores", snapshot.id),
      snapshot.data(),
    );
    remove(doc(db, "teamScores", snapshot.id));
  });

  schedule.lines.forEach((line) => {
    const storedLine: StoredScheduleLine = {
      lineNumber: line.lineNumber,
      scheduleId: schedule.id,
      generatedAt: schedule.generatedAt,
      lockedAt: schedule.lockedAt ?? resetAt,
      assignments: line.assignments,
    };

    set(
      doc(db, "privateSchedules", String(line.lineNumber)),
      storedLine as unknown as Record<string, unknown>,
    );
  });

  const weekOneRows: PublicWeekRow[] = schedule.lines.map((line) => {
    const assignment = line.assignments.find((item) => item.week === 1);

    if (!assignment) {
      throw new Error(
        `Replacement Schedule #${line.lineNumber} is missing Week 1.`,
      );
    }

    return {
      lineId: String(line.lineNumber),
      teamCode: assignment.teamCode,
      teamName: assignment.teamName,
      isBye: assignment.isBye,
    };
  });

  set(doc(db, "weeklyPublic", "1"), {
    week: 1,
    publishedAt: resetAt,
    rows: weekOneRows,
  });

  set(doc(db, "poolConfig", "main"), {
    poolName:
      typeof config.poolName === "string"
        ? config.poolName
        : "33 Pool Setup",
    season: 2026,
    currentWeek: 1,
    numberSelectionOpen: false,
    schedulesLocked: true,
    scheduleId: schedule.id,
    scheduleGeneratedAt: schedule.generatedAt,
    scheduleLockedAt: schedule.lockedAt,
    seasonLaunched: false,
    seasonLaunchedAt: null,
    seasonLaunchedByUid: null,
    seasonLaunchedByEmail: null,
    seasonLaunchedByName: null,
    seasonLaunchId: null,
    weekOneLocked: false,
    lastPullResetAt: resetAt,
    lastPullArchiveId: archiveId,
    updatedAt: resetAt,
  });

  set(doc(collection(db, "audit")), {
    actionType: "pull_2026_reset",
    archiveId,
    previousScheduleId,
    newScheduleId: schedule.id,
    previousClaimCount: claimSnapshots.size,
    commissionerUid: user.uid,
    commissionerEmail: user.email ?? "",
    createdAt: resetAt,
  });

  if (operationCount > 450) {
    throw new Error(
      "The current pull contains too many records for a safe preseason reset.",
    );
  }

  await batch.commit();

  return {
    archive_id: archiveId,
    new_schedule_id: schedule.id,
    previous_schedule_id: previousScheduleId,
    previous_claim_count: claimSnapshots.size,
    reset_at: resetAt,
  };
}

