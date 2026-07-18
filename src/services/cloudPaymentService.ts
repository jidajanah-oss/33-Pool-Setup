import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  where,
} from "firebase/firestore";
import { requireFirebaseAuth, requireFirestore } from "../lib/firebase";
import type {
  CloudPaymentAccount,
  CloudPaymentEntryInput,
  CloudPaymentTransaction,
  CloudRole,
} from "../types/cloud";

const SEASON_AMOUNT_DUE_CENTS = 5_400;
const WEEKLY_AMOUNT_DUE_CENTS = 300;

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

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : fallback;
}

function normalizeCurrentWeek(currentWeek: number): number {
  if (!Number.isInteger(currentWeek)) {
    return 1;
  }

  return Math.min(18, Math.max(1, currentWeek));
}

function buildAccount(
  uid: string,
  playerName: string,
  scheduleNumber: number | null,
  data: StoredPaymentSummary | undefined,
  currentWeek: number,
): CloudPaymentAccount {
  const normalizedWeek = normalizeCurrentWeek(currentWeek);
  const amountPaidCents = Math.max(0, asNumber(data?.amountPaidCents));
  const seasonAmountDueCents = Math.max(
    0,
    asNumber(data?.seasonAmountDueCents, SEASON_AMOUNT_DUE_CENTS),
  );
  const dueThroughCurrentWeek = Math.min(
    seasonAmountDueCents,
    normalizedWeek * WEEKLY_AMOUNT_DUE_CENTS,
  );
  const amountBehindCents = Math.max(
    0,
    dueThroughCurrentWeek - amountPaidCents,
  );

  return {
    uid,
    player_name: playerName,
    schedule_number: scheduleNumber,
    amount_paid_cents: amountPaidCents,
    season_amount_due_cents: seasonAmountDueCents,
    winnings_earned_cents: Math.max(
      0,
      asNumber(data?.winningsEarnedCents),
    ),
    winnings_paid_cents: Math.max(0, asNumber(data?.winningsPaidCents)),
    updated_at: asString(data?.updatedAt),
    amount_due_through_current_week_cents: dueThroughCurrentWeek,
    remaining_season_balance_cents: Math.max(
      0,
      seasonAmountDueCents - amountPaidCents,
    ),
    amount_behind_cents: amountBehindCents,
    payment_status: amountBehindCents === 0 ? "current" : "behind",
  };
}

async function getCurrentRole(): Promise<CloudRole> {
  const db = requireFirestore();
  const user = requireCurrentUser();
  const adminSnapshot = await getDoc(doc(db, "admins", user.uid));

  if (!adminSnapshot.exists()) {
    return "player";
  }

  return adminSnapshot.data().role === "co_commissioner"
    ? "co_commissioner"
    : "primary_commissioner";
}

async function requireCommissioner(): Promise<void> {
  if ((await getCurrentRole()) === "player") {
    throw new Error("Commissioner access is required.");
  }
}

function mapTransaction(
  id: string,
  data: Record<string, unknown>,
): CloudPaymentTransaction {
  const direction =
    data.direction === "debit" ? "debit" : "credit";
  const method =
    data.method === "check" ||
    data.method === "venmo" ||
    data.method === "paypal" ||
    data.method === "other"
      ? data.method
      : "cash";

  return {
    id,
    uid: asString(data.uid),
    player_name: asString(data.playerName, "Player"),
    schedule_number: asNumber(data.scheduleNumber),
    amount_cents: Math.max(0, asNumber(data.amountCents)),
    direction,
    method,
    note: asString(data.note),
    occurred_at: asString(data.occurredAt),
    created_at: asString(data.createdAt),
    created_by_uid: asString(data.createdByUid),
    created_by_name: asString(data.createdByName, "Commissioner"),
  };
}

export async function fetchMyPaymentAccount(
  currentWeek: number,
): Promise<CloudPaymentAccount> {
  const db = requireFirestore();
  const user = requireCurrentUser();

  const [profileSnapshot, claimSnapshot, paymentSnapshot] =
    await Promise.all([
      getDoc(doc(db, "users", user.uid)),
      getDoc(doc(db, "userClaims", user.uid)),
      getDoc(doc(db, "payments", user.uid)),
    ]);

  const playerName = profileSnapshot.exists()
    ? asString(profileSnapshot.data().displayName, "Player")
    : user.email?.split("@")[0] ?? "Player";
  const scheduleNumber = claimSnapshot.exists()
    ? Number(claimSnapshot.data().lineId)
    : null;

  return buildAccount(
    user.uid,
    playerName,
    Number.isInteger(scheduleNumber) ? scheduleNumber : null,
    paymentSnapshot.exists()
      ? (paymentSnapshot.data() as StoredPaymentSummary)
      : undefined,
    currentWeek,
  );
}

export async function fetchPaymentTransactionsForUid(
  uid: string,
): Promise<CloudPaymentTransaction[]> {
  const db = requireFirestore();
  const snapshot = await getDocs(
    query(
      collection(db, "paymentTransactions"),
      where("uid", "==", uid),
    ),
  );

  return snapshot.docs
    .map((transactionSnapshot) =>
      mapTransaction(
        transactionSnapshot.id,
        transactionSnapshot.data(),
      ),
    )
    .sort((a, b) => {
      const byOccurredAt = b.occurred_at.localeCompare(a.occurred_at);
      return byOccurredAt !== 0
        ? byOccurredAt
        : b.created_at.localeCompare(a.created_at);
    });
}

export async function fetchCommissionerPaymentAccounts(
  currentWeek: number,
): Promise<CloudPaymentAccount[]> {
  await requireCommissioner();

  const db = requireFirestore();
  const [claimSnapshots, paymentSnapshots] = await Promise.all([
    getDocs(collection(db, "claims")),
    getDocs(collection(db, "payments")),
  ]);

  const paymentsByUid = new Map<string, StoredPaymentSummary>();

  paymentSnapshots.forEach((paymentSnapshot) => {
    paymentsByUid.set(
      paymentSnapshot.id,
      paymentSnapshot.data() as StoredPaymentSummary,
    );
  });

  return claimSnapshots.docs
    .map((claimSnapshot) => {
      const data = claimSnapshot.data();
      const uid = asString(data.uid);
      const playerName = asString(data.playerName, "Player");
      const scheduleNumber = Number(claimSnapshot.id);

      return buildAccount(
        uid,
        playerName,
        Number.isInteger(scheduleNumber) ? scheduleNumber : null,
        paymentsByUid.get(uid),
        currentWeek,
      );
    })
    .sort(
      (a, b) =>
        (a.schedule_number ?? 99) - (b.schedule_number ?? 99),
    );
}

export async function recordCloudPaymentTransaction(
  input: CloudPaymentEntryInput,
): Promise<void> {
  await requireCommissioner();

  if (!input.uid) {
    throw new Error("Choose a claimed player.");
  }

  if (
    !Number.isInteger(input.schedule_number) ||
    input.schedule_number < 1 ||
    input.schedule_number > 32
  ) {
    throw new Error("The player's schedule number is invalid.");
  }

  if (
    !Number.isInteger(input.amount_cents) ||
    input.amount_cents <= 0 ||
    input.amount_cents > SEASON_AMOUNT_DUE_CENTS
  ) {
    throw new Error("Enter a valid payment amount.");
  }

  const cleanNote = input.note.trim().slice(0, 200);
  const db = requireFirestore();
  const commissioner = requireCurrentUser();
  const now = new Date().toISOString();
  const paymentRef = doc(db, "payments", input.uid);
  const claimRef = doc(db, "userClaims", input.uid);
  const transactionRef = doc(collection(db, "paymentTransactions"));
  const auditRef = doc(collection(db, "audit"));
  const commissionerProfileRef = doc(db, "users", commissioner.uid);

  await runTransaction(db, async (transaction) => {
    const [
      claimSnapshot,
      paymentSnapshot,
      commissionerProfileSnapshot,
    ] = await Promise.all([
      transaction.get(claimRef),
      transaction.get(paymentRef),
      transaction.get(commissionerProfileRef),
    ]);

    if (!claimSnapshot.exists()) {
      throw new Error("That player no longer has a schedule claim.");
    }

    const claimedScheduleNumber = Number(
      claimSnapshot.data().lineId,
    );

    if (claimedScheduleNumber !== input.schedule_number) {
      throw new Error("The player's schedule claim changed. Refresh the ledger.");
    }

    const currentData = paymentSnapshot.exists()
      ? (paymentSnapshot.data() as StoredPaymentSummary)
      : undefined;
    const currentAmountPaid = Math.max(
      0,
      asNumber(currentData?.amountPaidCents),
    );
    const delta =
      input.direction === "debit"
        ? -input.amount_cents
        : input.amount_cents;
    const nextAmountPaid = currentAmountPaid + delta;

    if (nextAmountPaid < 0) {
      throw new Error(
        "A refund or negative adjustment cannot reduce the paid balance below $0.",
      );
    }

    if (nextAmountPaid > SEASON_AMOUNT_DUE_CENTS) {
      throw new Error(
        "The player's paid balance cannot exceed the $54 season total.",
      );
    }

    const commissionerName = commissionerProfileSnapshot.exists()
      ? asString(
          commissionerProfileSnapshot.data().displayName,
          "Commissioner",
        )
      : "Commissioner";

    transaction.set(
      paymentRef,
      {
        uid: input.uid,
        playerName: input.player_name,
        scheduleNumber: input.schedule_number,
        amountPaidCents: nextAmountPaid,
        seasonAmountDueCents: SEASON_AMOUNT_DUE_CENTS,
        winningsEarnedCents: Math.max(
          0,
          asNumber(currentData?.winningsEarnedCents),
        ),
        winningsPaidCents: Math.max(
          0,
          asNumber(currentData?.winningsPaidCents),
        ),
        updatedAt: now,
      },
      { merge: false },
    );

    transaction.set(transactionRef, {
      uid: input.uid,
      playerName: input.player_name,
      scheduleNumber: input.schedule_number,
      amountCents: input.amount_cents,
      direction: input.direction,
      method: input.method,
      note: cleanNote,
      occurredAt: input.occurred_at,
      createdAt: now,
      createdByUid: commissioner.uid,
      createdByName: commissionerName,
    });

    transaction.set(auditRef, {
      actionType: "payment_transaction_recorded",
      affectedUid: input.uid,
      affectedPlayerName: input.player_name,
      scheduleNumber: input.schedule_number,
      amountCents: input.amount_cents,
      direction: input.direction,
      paymentMethod: input.method,
      note: cleanNote,
      commissionerUid: commissioner.uid,
      commissionerName,
      createdAt: now,
    });
  });
}
