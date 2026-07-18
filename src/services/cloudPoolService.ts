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
import { getCloudRoleForUid } from "./cloudRoleService";
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
    updatedAt: new Date().toISOString(),
  });

  await batch.commit();
}

export async function setCloudEnrollmentOpen(
  open: boolean,
): Promise<void> {
  const db = requireFirestore();

  await updateDoc(doc(db, "poolConfig", "main"), {
    numberSelectionOpen: open,
    updatedAt: new Date().toISOString(),
  });
}

export async function releaseCloudNumber(
  scheduleNumber: number,
): Promise<void> {
  const db = requireFirestore();
  const claimRef = doc(db, "claims", String(scheduleNumber));
  const claimSnapshot = await getDoc(claimRef);

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
