import { doc, getDoc } from "firebase/firestore";
import { requireFirebaseAuth, requireFirestore } from "../lib/firebase";
import type { CloudRole } from "../types/cloud";

export const PRIMARY_COMMISSIONER_UID =
  "jytf6FyhvoSnMEOsaV6OyWPNXfv2";

export const PRIMARY_COMMISSIONER_EMAIL =
  "jidajanah@gmail.com";

interface StoredCommissionerTeam {
  backup1Uid?: unknown;
  backup2Uid?: unknown;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function normalizeEmail(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

export function isPrimaryCommissionerIdentity(
  uid: string,
  email?: string | null,
): boolean {
  if (uid === PRIMARY_COMMISSIONER_UID) {
    return true;
  }

  if (normalizeEmail(email) === PRIMARY_COMMISSIONER_EMAIL) {
    return true;
  }

  const currentUser = requireFirebaseAuth().currentUser;

  return Boolean(
    currentUser &&
      currentUser.uid === uid &&
      normalizeEmail(currentUser.email) ===
        PRIMARY_COMMISSIONER_EMAIL,
  );
}

export async function getCloudRoleForUid(
  uid: string,
  email?: string | null,
): Promise<CloudRole> {
  if (isPrimaryCommissionerIdentity(uid, email)) {
    return "primary_commissioner";
  }

  const db = requireFirestore();
  const teamSnapshot = await getDoc(
    doc(db, "commissionerTeam", "main"),
  );

  if (teamSnapshot.exists()) {
    const team = teamSnapshot.data() as StoredCommissionerTeam;

    if (
      asString(team.backup1Uid) === uid ||
      asString(team.backup2Uid) === uid
    ) {
      return "co_commissioner";
    }
  }

  return "player";
}

export async function getCurrentCloudRole(): Promise<CloudRole> {
  const user = requireFirebaseAuth().currentUser;

  if (!user) {
    throw new Error("Sign in to Firebase first.");
  }

  return getCloudRoleForUid(user.uid, user.email);
}

export async function requireCloudCommissioner(): Promise<CloudRole> {
  const role = await getCurrentCloudRole();

  if (role === "player") {
    throw new Error("Commissioner access is required.");
  }

  return role;
}

export async function requireCloudPrimary(): Promise<void> {
  const role = await requireCloudCommissioner();

  if (role !== "primary_commissioner") {
    throw new Error(
      "Only the Primary Commissioner can manage backup commissioners.",
    );
  }
}
