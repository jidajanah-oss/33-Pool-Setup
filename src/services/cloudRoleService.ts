import { doc, getDoc } from "firebase/firestore";
import { requireFirebaseAuth, requireFirestore } from "../lib/firebase";
import type { CloudRole } from "../types/cloud";

export const PRIMARY_COMMISSIONER_UID =
  "jytf6FyhvoSnMEOsaV6OyWPNXfv2";

interface StoredCommissionerTeam {
  backup1Uid?: unknown;
  backup2Uid?: unknown;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export async function getCloudRoleForUid(
  uid: string,
): Promise<CloudRole> {
  if (uid === PRIMARY_COMMISSIONER_UID) {
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

  return getCloudRoleForUid(user.uid);
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
