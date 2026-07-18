import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  setDoc,
  where,
} from "firebase/firestore";
import { NFL_2026_TEAMS } from "../data/nfl2026";
import { requireFirebaseAuth, requireFirestore } from "../lib/firebase";
import type {
  CloudResolutionPreview,
  CloudResolutionType,
  CloudResolutionWinnerPreview,
  CloudScoringAssignment,
  CloudScoringWeekSnapshot,
  CloudTeamScore,
  CloudWeeklyResult,
  CloudWinnerRecord,
} from "../types/cloud";
import type { GeneratedScheduleAssignment } from "../types/pool";

const WEEKLY_ADDITION_CENTS = 9_600;
const WEEKLY_PLAYER_DUE_CENTS = 300;
const SEASON_AMOUNT_DUE_CENTS = 5_400;
const TARGET_SCORE = 33;

interface StoredScheduleLine {
  lineNumber: number;
  assignments: GeneratedScheduleAssignment[];
}

interface StoredClaim {
  uid?: unknown;
  playerName?: unknown;
}

interface StoredPaymentSummary {
  uid?: unknown;
  playerName?: unknown;
  scheduleNumber?: unknown;
  amountPaidCents?: unknown;
  seasonAmountDueCents?: unknown;
  winningsEarnedCents?: unknown;
  winningsPaidCents?: unknown;
  updatedAt?: unknown;
}

function requireCurrentUser() {
  const user = requireFirebaseAuth().currentUser;

  if (!user) {
    throw new Error("Sign in to Firebase first.");
  }

  return user;
}

async function requireCommissioner(): Promise<void> {
  const db = requireFirestore();
  const user = requireCurrentUser();
  const adminSnapshot = await getDoc(doc(db, "admins", user.uid));

  if (!adminSnapshot.exists()) {
    throw new Error("Commissioner access is required.");
  }
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : fallback;
}

function normalizeWeek(week: number): number {
  if (!Number.isInteger(week) || week < 1 || week > 18) {
    throw new Error("NFL week must be between 1 and 18.");
  }

  return week;
}

function teamByCode(code: string) {
  return NFL_2026_TEAMS.find((team) => team.code === code);
}

function defaultScoresForWeek(week: number): CloudTeamScore[] {
  return NFL_2026_TEAMS.map((team) => {
    const isBye = team.byeWeek === week;

    return {
      team_code: team.code,
      team_name: team.name,
      status: isBye ? "bye" : "not_started",
      score: null,
    };
  });
}

function normalizeScores(
  week: number,
  rows: unknown,
): CloudTeamScore[] {
  const storedRows = Array.isArray(rows)
    ? (rows as Array<Record<string, unknown>>)
    : [];
  const byCode = new Map(
    storedRows.map((row) => [asString(row.teamCode), row]),
  );

  return NFL_2026_TEAMS.map((team) => {
    const row = byCode.get(team.code);
    const isBye = team.byeWeek === week;
    const rawScore =
      row && typeof row.score === "number" && Number.isInteger(row.score)
        ? row.score
        : null;

    return {
      team_code: team.code,
      team_name: team.name,
      status: isBye
        ? "bye"
        : row?.status === "final" && rawScore !== null
          ? "final"
          : "not_started",
      score: isBye ? null : rawScore,
    };
  });
}

function mapWeeklyResult(
  week: number,
  data: Record<string, unknown>,
): CloudWeeklyResult {
  const rawType = asString(data.resolutionType);
  const resolutionType: CloudResolutionType =
    rawType === "exact_33" || rawType === "closest_33"
      ? rawType
      : "carryover";

  return {
    week,
    weekly_addition_cents: asNumber(
      data.weeklyAdditionCents,
      WEEKLY_ADDITION_CENTS,
    ),
    carryover_in_cents: asNumber(data.carryoverInCents),
    total_pot_cents: asNumber(data.totalPotCents),
    resolution_type: resolutionType,
    qualifying_team_codes: Array.isArray(data.qualifyingTeamCodes)
      ? data.qualifyingTeamCodes.filter(
          (value): value is string => typeof value === "string",
        )
      : [],
    winner_count: asNumber(data.winnerCount),
    total_payout_cents: asNumber(data.totalPayoutCents),
    carryover_out_cents: asNumber(data.carryoverOutCents),
    finalized_at: asString(data.finalizedAt),
    finalized_by_uid: asString(data.finalizedByUid),
    finalized_by_name: asString(data.finalizedByName, "Commissioner"),
  };
}

function mapWinner(
  id: string,
  data: Record<string, unknown>,
): CloudWinnerRecord {
  const payoutStatus =
    data.payoutStatus === "paid"
      ? "paid"
      : data.payoutStatus === "on_hold"
        ? "on_hold"
        : "pending";

  return {
    id,
    week: asNumber(data.week),
    uid: asString(data.uid),
    player_name: asString(data.playerName, "Player"),
    schedule_number: asNumber(data.scheduleNumber),
    team_code: asString(data.teamCode),
    team_name: asString(data.teamName),
    final_score: asNumber(data.finalScore),
    distance_from_33: asNumber(data.distanceFrom33),
    payout_cents: asNumber(data.payoutCents),
    payout_status: payoutStatus,
    payment_eligible_at_finalization:
      data.paymentEligibleAtFinalization === true,
    finalized_at: asString(data.finalizedAt),
    paid_at:
      typeof data.paidAt === "string" ? data.paidAt : null,
  };
}

function distributePot(
  totalPotCents: number,
  winners: CloudResolutionWinnerPreview[],
): CloudResolutionWinnerPreview[] {
  if (winners.length === 0) {
    return [];
  }

  const base = Math.floor(totalPotCents / winners.length);
  const remainder = totalPotCents % winners.length;

  return [...winners]
    .sort((a, b) => a.schedule_number - b.schedule_number)
    .map((winner, index) => ({
      ...winner,
      payout_cents: base + (index < remainder ? 1 : 0),
    }));
}

function completePlayingScores(
  week: number,
  scores: readonly CloudTeamScore[],
): boolean {
  const byCode = new Map(scores.map((score) => [score.team_code, score]));

  return NFL_2026_TEAMS.every((team) => {
    if (team.byeWeek === week) {
      return true;
    }

    const row = byCode.get(team.code);

    return Boolean(
      row &&
        row.status === "final" &&
        Number.isInteger(row.score) &&
        row.score !== null &&
        row.score >= 0 &&
        row.score <= 99,
    );
  });
}

function calculateCarryoverIn(
  week: number,
  history: readonly CloudWeeklyResult[],
): number {
  if (week === 1) {
    return 0;
  }

  return (
    history.find((result) => result.week === week - 1)
      ?.carryover_out_cents ?? 0
  );
}

export function calculateCloudResolutionPreview(
  week: number,
  scores: readonly CloudTeamScore[],
  assignments: readonly CloudScoringAssignment[],
  history: readonly CloudWeeklyResult[],
): CloudResolutionPreview {
  normalizeWeek(week);

  const completeScores = completePlayingScores(week, scores);
  const claimedCount = assignments.filter(
    (assignment) => Boolean(assignment.uid),
  ).length;
  const allPlayersClaimed = claimedCount === 32;
  const carryoverInCents = calculateCarryoverIn(week, history);
  const totalPotCents = carryoverInCents + WEEKLY_ADDITION_CENTS;
  const scoreByCode = new Map(
    scores.map((score) => [score.team_code, score]),
  );

  const exactCodes = NFL_2026_TEAMS.filter((team) => {
    if (team.byeWeek === week) {
      return false;
    }

    const score = scoreByCode.get(team.code);
    return score?.status === "final" && score.score === TARGET_SCORE;
  }).map((team) => team.code);

  let resolutionType: CloudResolutionType = "carryover";
  let qualifyingCodes: string[] = exactCodes;

  if (exactCodes.length > 0) {
    resolutionType = "exact_33";
  } else if (week === 18 && completeScores) {
    const playingScores = NFL_2026_TEAMS.filter(
      (team) => team.byeWeek !== week,
    )
      .map((team) => {
        const score = scoreByCode.get(team.code)?.score;
        return {
          code: team.code,
          score: typeof score === "number" ? score : 0,
          distance: Math.abs(
            (typeof score === "number" ? score : 0) - TARGET_SCORE,
          ),
        };
      });

    const minimumDistance = Math.min(
      ...playingScores.map((row) => row.distance),
    );

    qualifyingCodes = playingScores
      .filter((row) => row.distance === minimumDistance)
      .map((row) => row.code);
    resolutionType = "closest_33";
  }

  const rawWinners: CloudResolutionWinnerPreview[] =
    qualifyingCodes.flatMap((code) => {
      const assignment = assignments.find(
        (item) => item.team_code === code,
      );
      const score = scoreByCode.get(code);
      const team = teamByCode(code);

      if (!assignment || !score || score.score === null || !team) {
        return [];
      }

      return [
        {
          uid: assignment.uid,
          player_name: assignment.player_name ?? "Unclaimed schedule",
          schedule_number: assignment.schedule_number,
          team_code: code,
          team_name: team.name,
          final_score: score.score,
          distance_from_33: Math.abs(score.score - TARGET_SCORE),
          payout_cents: 0,
        },
      ];
    });

  const winners =
    resolutionType === "carryover"
      ? []
      : distributePot(totalPotCents, rawWinners);
  const blockingReasons: string[] = [];

  if (!completeScores) {
    blockingReasons.push(
      "Every playing NFL team must have a final score.",
    );
  }

  if (!allPlayersClaimed) {
    blockingReasons.push(
      `All 32 schedule numbers must be claimed. Current claims: ${claimedCount}.`,
    );
  }

  if (
    resolutionType !== "carryover" &&
    winners.some((winner) => !winner.uid)
  ) {
    blockingReasons.push(
      "Every qualifying schedule line must belong to a signed-in player.",
    );
  }

  return {
    week,
    complete_scores: completeScores,
    claimed_count: claimedCount,
    all_players_claimed: allPlayersClaimed,
    weekly_addition_cents: WEEKLY_ADDITION_CENTS,
    carryover_in_cents: carryoverInCents,
    total_pot_cents: totalPotCents,
    resolution_type: resolutionType,
    qualifying_team_codes: qualifyingCodes,
    winners,
    carryover_out_cents:
      resolutionType === "carryover" ? totalPotCents : 0,
    can_finalize: blockingReasons.length === 0,
    blocking_reasons: blockingReasons,
  };
}

async function fetchAssignmentsForWeek(
  week: number,
): Promise<CloudScoringAssignment[]> {
  const db = requireFirestore();
  const [scheduleSnapshots, claimSnapshots] = await Promise.all([
    getDocs(collection(db, "privateSchedules")),
    getDocs(collection(db, "claims")),
  ]);
  const claimsByNumber = new Map<number, { uid: string; name: string }>();

  claimSnapshots.forEach((snapshot) => {
    const line = Number(snapshot.id);
    const data = snapshot.data() as StoredClaim;

    if (Number.isInteger(line)) {
      claimsByNumber.set(line, {
        uid: asString(data.uid),
        name: asString(data.playerName, "Player"),
      });
    }
  });

  return scheduleSnapshots.docs
    .map((snapshot) => {
      const lineNumber = Number(snapshot.id);
      const data = snapshot.data() as StoredScheduleLine;
      const assignment = data.assignments?.find(
        (item) => item.week === week,
      );
      const claim = claimsByNumber.get(lineNumber);

      if (!assignment || !Number.isInteger(lineNumber)) {
        return null;
      }

      return {
        schedule_number: lineNumber,
        uid: claim?.uid || null,
        player_name: claim?.name || null,
        team_code: assignment.teamCode,
        team_name: assignment.teamName,
        is_bye: assignment.isBye,
      } satisfies CloudScoringAssignment;
    })
    .filter(
      (value): value is CloudScoringAssignment => value !== null,
    )
    .sort((a, b) => a.schedule_number - b.schedule_number);
}

export async function fetchCloudWeeklyResultHistory(): Promise<
  CloudWeeklyResult[]
> {
  const db = requireFirestore();
  const snapshots = await getDocs(collection(db, "weeklyResults"));

  return snapshots.docs
    .map((snapshot) =>
      mapWeeklyResult(Number(snapshot.id), snapshot.data()),
    )
    .filter((result) => Number.isInteger(result.week))
    .sort((a, b) => a.week - b.week);
}

export async function fetchCloudScoringWeek(
  week: number,
  includeAssignments: boolean,
): Promise<CloudScoringWeekSnapshot> {
  normalizeWeek(week);
  const db = requireFirestore();
  const [scoreSnapshot, resultSnapshot, winnerSnapshots, assignments] =
    await Promise.all([
      getDoc(doc(db, "teamScores", String(week))),
      getDoc(doc(db, "weeklyResults", String(week))),
      getDocs(
        query(
          collection(db, "winners"),
          where("week", "==", week),
        ),
      ),
      includeAssignments
        ? fetchAssignmentsForWeek(week)
        : Promise.resolve([]),
    ]);

  return {
    week,
    scores: scoreSnapshot.exists()
      ? normalizeScores(week, scoreSnapshot.data().rows)
      : defaultScoresForWeek(week),
    result: resultSnapshot.exists()
      ? mapWeeklyResult(week, resultSnapshot.data())
      : null,
    winners: winnerSnapshots.docs
      .map((snapshot) => mapWinner(snapshot.id, snapshot.data()))
      .sort((a, b) => a.schedule_number - b.schedule_number),
    assignments,
  };
}

export async function saveCloudTeamScores(
  week: number,
  scores: readonly CloudTeamScore[],
): Promise<void> {
  await requireCommissioner();
  normalizeWeek(week);
  const db = requireFirestore();
  const resultSnapshot = await getDoc(
    doc(db, "weeklyResults", String(week)),
  );

  if (resultSnapshot.exists()) {
    throw new Error(
      "This week is finalized. Reopen it before changing scores.",
    );
  }

  const byCode = new Map(scores.map((score) => [score.team_code, score]));

  const rows = NFL_2026_TEAMS.map((team) => {
    const input = byCode.get(team.code);
    const isBye = team.byeWeek === week;
    const rawScore = input?.score;

    if (
      rawScore !== null &&
      rawScore !== undefined &&
      (!Number.isInteger(rawScore) || rawScore < 0 || rawScore > 99)
    ) {
      throw new Error(
        `${team.name} must have a whole-number score from 0 through 99.`,
      );
    }

    return {
      teamCode: team.code,
      teamName: team.name,
      status: isBye
        ? "bye"
        : typeof rawScore === "number"
          ? "final"
          : "not_started",
      score: isBye ? null : (rawScore ?? null),
    };
  });

  const user = requireCurrentUser();
  const now = new Date().toISOString();

  await setDoc(
    doc(db, "teamScores", String(week)),
    {
      week,
      rows,
      finalized: false,
      updatedAt: now,
      updatedByUid: user.uid,
    },
    { merge: false },
  );
}

async function commissionerName(uid: string): Promise<string> {
  const db = requireFirestore();
  const profileSnapshot = await getDoc(doc(db, "users", uid));

  return profileSnapshot.exists()
    ? asString(profileSnapshot.data().displayName, "Commissioner")
    : "Commissioner";
}

export async function finalizeCloudWeek(week: number): Promise<void> {
  await requireCommissioner();
  normalizeWeek(week);
  const db = requireFirestore();
  const user = requireCurrentUser();
  const name = await commissionerName(user.uid);
  const scheduleSnapshots = await getDocs(
    collection(db, "privateSchedules"),
  );

  const scheduleAssignments = scheduleSnapshots.docs
    .map((snapshot) => {
      const lineNumber = Number(snapshot.id);
      const data = snapshot.data() as StoredScheduleLine;
      const assignment = data.assignments?.find(
        (item) => item.week === week,
      );

      return assignment && Number.isInteger(lineNumber)
        ? {
            lineNumber,
            assignment,
          }
        : null;
    })
    .filter(
      (
        value,
      ): value is {
        lineNumber: number;
        assignment: GeneratedScheduleAssignment;
      } => value !== null,
    );

  if (scheduleAssignments.length !== 32) {
    throw new Error(
      "The published Firebase schedule is incomplete for this week.",
    );
  }

  const configRef = doc(db, "poolConfig", "main");
  const scoreRef = doc(db, "teamScores", String(week));
  const resultRef = doc(db, "weeklyResults", String(week));
  const previousResultRef =
    week > 1 ? doc(db, "weeklyResults", String(week - 1)) : null;
  const auditRef = doc(collection(db, "audit"));

  await runTransaction(db, async (transaction) => {
    const baseReads = [
      transaction.get(configRef),
      transaction.get(scoreRef),
      transaction.get(resultRef),
    ];
    const [configSnapshot, scoreSnapshot, resultSnapshot] =
      await Promise.all(baseReads);
    const previousResultSnapshot = previousResultRef
      ? await transaction.get(previousResultRef)
      : null;

    if (!configSnapshot.exists()) {
      throw new Error("Firebase pool configuration is missing.");
    }

    if (asNumber(configSnapshot.data().currentWeek, 1) !== week) {
      throw new Error(
        `Only the current pool week can be finalized. Current week: ${asNumber(
          configSnapshot.data().currentWeek,
          1,
        )}.`,
      );
    }

    if (resultSnapshot.exists()) {
      throw new Error(`Week ${week} is already finalized.`);
    }

    if (!scoreSnapshot.exists()) {
      throw new Error("Save the final NFL team scores first.");
    }

    const claimRefs = Array.from({ length: 32 }, (_, index) =>
      doc(db, "claims", String(index + 1)),
    );
    const claimSnapshots = await Promise.all(
      claimRefs.map((ref) => transaction.get(ref)),
    );
    const claimByLine = new Map<
      number,
      { uid: string; playerName: string }
    >();

    claimSnapshots.forEach((snapshot, index) => {
      if (snapshot.exists()) {
        claimByLine.set(index + 1, {
          uid: asString(snapshot.data().uid),
          playerName: asString(
            snapshot.data().playerName,
            "Player",
          ),
        });
      }
    });

    const assignments: CloudScoringAssignment[] =
      scheduleAssignments.map(({ lineNumber, assignment }) => {
        const claim = claimByLine.get(lineNumber);

        return {
          schedule_number: lineNumber,
          uid: claim?.uid || null,
          player_name: claim?.playerName || null,
          team_code: assignment.teamCode,
          team_name: assignment.teamName,
          is_bye: assignment.isBye,
        };
      });
    const scores = normalizeScores(
      week,
      scoreSnapshot.data().rows,
    );
    const history: CloudWeeklyResult[] = previousResultSnapshot?.exists()
      ? [
          mapWeeklyResult(
            week - 1,
            previousResultSnapshot.data(),
          ),
        ]
      : [];
    const preview = calculateCloudResolutionPreview(
      week,
      scores,
      assignments,
      history,
    );

    if (!preview.can_finalize) {
      throw new Error(preview.blocking_reasons.join(" "));
    }

    const winnerPaymentReads = await Promise.all(
      preview.winners.map((winner) =>
        transaction.get(doc(db, "payments", winner.uid ?? "missing")),
      ),
    );
    const now = new Date().toISOString();

    transaction.set(resultRef, {
      week,
      weeklyAdditionCents: preview.weekly_addition_cents,
      carryoverInCents: preview.carryover_in_cents,
      totalPotCents: preview.total_pot_cents,
      resolutionType: preview.resolution_type,
      qualifyingTeamCodes: preview.qualifying_team_codes,
      winnerCount: preview.winners.length,
      totalPayoutCents: preview.winners.reduce(
        (sum, winner) => sum + winner.payout_cents,
        0,
      ),
      carryoverOutCents: preview.carryover_out_cents,
      finalizedAt: now,
      finalizedByUid: user.uid,
      finalizedByName: name,
    });

    preview.winners.forEach((winner, index) => {
      if (!winner.uid) {
        throw new Error(
          `Schedule #${winner.schedule_number} has no player claim.`,
        );
      }

      const paymentSnapshot = winnerPaymentReads[index];
      const currentPayment = paymentSnapshot.exists()
        ? (paymentSnapshot.data() as StoredPaymentSummary)
        : undefined;
      const amountPaidCents = Math.max(
        0,
        asNumber(currentPayment?.amountPaidCents),
      );
      const winningsEarnedCents = Math.max(
        0,
        asNumber(currentPayment?.winningsEarnedCents),
      );
      const winningsPaidCents = Math.max(
        0,
        asNumber(currentPayment?.winningsPaidCents),
      );
      const eligible =
        amountPaidCents >=
        Math.min(SEASON_AMOUNT_DUE_CENTS, week * WEEKLY_PLAYER_DUE_CENTS);
      const winnerId = `${week}-${winner.schedule_number}`;

      transaction.set(doc(db, "winners", winnerId), {
        week,
        uid: winner.uid,
        playerName: winner.player_name,
        scheduleNumber: winner.schedule_number,
        teamCode: winner.team_code,
        teamName: winner.team_name,
        finalScore: winner.final_score,
        distanceFrom33: winner.distance_from_33,
        payoutCents: winner.payout_cents,
        payoutStatus: eligible ? "pending" : "on_hold",
        paymentEligibleAtFinalization: eligible,
        finalizedAt: now,
        paidAt: null,
      });

      transaction.set(
        doc(db, "payments", winner.uid),
        {
          uid: winner.uid,
          playerName: winner.player_name,
          scheduleNumber: winner.schedule_number,
          amountPaidCents,
          seasonAmountDueCents: SEASON_AMOUNT_DUE_CENTS,
          winningsEarnedCents:
            winningsEarnedCents + winner.payout_cents,
          winningsPaidCents,
          updatedAt: now,
        },
        { merge: false },
      );
    });

    transaction.set(
      scoreRef,
      {
        week,
        rows: scores.map((score) => ({
          teamCode: score.team_code,
          teamName: score.team_name,
          status: score.status,
          score: score.score,
        })),
        finalized: true,
        finalizedAt: now,
        finalizedByUid: user.uid,
        updatedAt: now,
        updatedByUid: user.uid,
      },
      { merge: false },
    );

    if (week < 18) {
      const nextRows = scheduleSnapshots.docs.map((snapshot) => {
        const lineNumber = Number(snapshot.id);
        const data = snapshot.data() as StoredScheduleLine;
        const assignment = data.assignments?.find(
          (item) => item.week === week + 1,
        );

        if (!assignment) {
          throw new Error(
            `Schedule #${lineNumber} is missing Week ${week + 1}.`,
          );
        }

        return {
          lineId: String(lineNumber),
          teamCode: assignment.teamCode,
          teamName: assignment.teamName,
          isBye: assignment.isBye,
        };
      });

      transaction.set(doc(db, "weeklyPublic", String(week + 1)), {
        week: week + 1,
        publishedAt: now,
        rows: nextRows,
      });
    }

    transaction.set(
      configRef,
      {
        ...configSnapshot.data(),
        currentWeek: week < 18 ? week + 1 : 18,
        numberSelectionOpen: false,
        seasonComplete: week === 18,
        updatedAt: now,
      },
      { merge: false },
    );

    transaction.set(auditRef, {
      actionType: "week_finalized",
      week,
      resolutionType: preview.resolution_type,
      totalPotCents: preview.total_pot_cents,
      winnerCount: preview.winners.length,
      commissionerUid: user.uid,
      commissionerName: name,
      createdAt: now,
    });
  });
}

export async function reopenCloudWeek(week: number): Promise<void> {
  await requireCommissioner();
  normalizeWeek(week);
  const db = requireFirestore();
  const user = requireCurrentUser();
  const name = await commissionerName(user.uid);
  const winnerSnapshots = await getDocs(
    query(collection(db, "winners"), where("week", "==", week)),
  );
  const winners = winnerSnapshots.docs.map((snapshot) =>
    mapWinner(snapshot.id, snapshot.data()),
  );

  if (winners.some((winner) => winner.payout_status === "paid")) {
    throw new Error(
      "A paid prize must be financially corrected before reopening this week.",
    );
  }

  const configRef = doc(db, "poolConfig", "main");
  const resultRef = doc(db, "weeklyResults", String(week));
  const scoreRef = doc(db, "teamScores", String(week));
  const auditRef = doc(collection(db, "audit"));

  await runTransaction(db, async (transaction) => {
    const [configSnapshot, resultSnapshot, scoreSnapshot] =
      await Promise.all([
        transaction.get(configRef),
        transaction.get(resultRef),
        transaction.get(scoreRef),
      ]);

    if (!resultSnapshot.exists()) {
      throw new Error(`Week ${week} is not finalized.`);
    }

    const currentWeek = configSnapshot.exists()
      ? asNumber(configSnapshot.data().currentWeek, 1)
      : 1;
    const seasonComplete =
      configSnapshot.exists() &&
      configSnapshot.data().seasonComplete === true;
    const expectedLatest =
      seasonComplete && week === 18 ? 18 : currentWeek - 1;

    if (week !== expectedLatest) {
      throw new Error(
        "Only the most recently finalized week can be reopened.",
      );
    }

    const paymentSnapshots = await Promise.all(
      winners.map((winner) =>
        transaction.get(doc(db, "payments", winner.uid)),
      ),
    );
    const now = new Date().toISOString();

    winners.forEach((winner, index) => {
      const paymentSnapshot = paymentSnapshots[index];

      if (paymentSnapshot.exists()) {
        const data = paymentSnapshot.data() as StoredPaymentSummary;

        transaction.set(
          paymentSnapshot.ref,
          {
            ...data,
            winningsEarnedCents: Math.max(
              0,
              asNumber(data.winningsEarnedCents) -
                winner.payout_cents,
            ),
            updatedAt: now,
          },
          { merge: false },
        );
      }

      transaction.delete(doc(db, "winners", winner.id));
    });

    transaction.delete(resultRef);

    if (scoreSnapshot.exists()) {
      transaction.set(
        scoreRef,
        {
          ...scoreSnapshot.data(),
          finalized: false,
          finalizedAt: null,
          finalizedByUid: null,
          updatedAt: now,
          updatedByUid: user.uid,
        },
        { merge: false },
      );
    }

    if (week < 18) {
      transaction.delete(doc(db, "weeklyPublic", String(week + 1)));
    }

    if (configSnapshot.exists()) {
      transaction.set(
        configRef,
        {
          ...configSnapshot.data(),
          currentWeek: week,
          seasonComplete: false,
          updatedAt: now,
        },
        { merge: false },
      );
    }

    transaction.set(auditRef, {
      actionType: "week_reopened",
      week,
      commissionerUid: user.uid,
      commissionerName: name,
      createdAt: now,
    });
  });
}

export async function markCloudWinnerPaid(
  winnerId: string,
): Promise<void> {
  await requireCommissioner();
  const db = requireFirestore();
  const user = requireCurrentUser();
  const name = await commissionerName(user.uid);
  const winnerRef = doc(db, "winners", winnerId);
  const auditRef = doc(collection(db, "audit"));

  await runTransaction(db, async (transaction) => {
    const winnerSnapshot = await transaction.get(winnerRef);

    if (!winnerSnapshot.exists()) {
      throw new Error("The winner record no longer exists.");
    }

    const winner = mapWinner(
      winnerSnapshot.id,
      winnerSnapshot.data(),
    );

    if (winner.payout_status === "paid") {
      return;
    }

    const paymentRef = doc(db, "payments", winner.uid);
    const paymentSnapshot = await transaction.get(paymentRef);

    if (!paymentSnapshot.exists()) {
      throw new Error("The player's payment account is missing.");
    }

    const payment = paymentSnapshot.data() as StoredPaymentSummary;
    const amountPaidCents = Math.max(
      0,
      asNumber(payment.amountPaidCents),
    );
    const requiredCents = Math.min(
      SEASON_AMOUNT_DUE_CENTS,
      winner.week * WEEKLY_PLAYER_DUE_CENTS,
    );

    if (amountPaidCents < requiredCents) {
      throw new Error(
        `${winner.player_name} must be paid through Week ${winner.week} before the prize can be marked paid.`,
      );
    }

    const winningsPaidCents = Math.max(
      0,
      asNumber(payment.winningsPaidCents),
    );
    const now = new Date().toISOString();

    transaction.set(
      winnerRef,
      {
        ...winnerSnapshot.data(),
        payoutStatus: "paid",
        paidAt: now,
      },
      { merge: false },
    );

    transaction.set(
      paymentRef,
      {
        ...payment,
        winningsPaidCents:
          winningsPaidCents + winner.payout_cents,
        updatedAt: now,
      },
      { merge: false },
    );

    transaction.set(auditRef, {
      actionType: "winner_payout_paid",
      week: winner.week,
      winnerId,
      uid: winner.uid,
      playerName: winner.player_name,
      payoutCents: winner.payout_cents,
      commissionerUid: user.uid,
      commissionerName: name,
      createdAt: now,
    });
  });
}
