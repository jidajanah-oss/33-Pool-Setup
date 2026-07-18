import { sendSignInLinkToEmail } from "firebase/auth";
import {
  collection,
  deleteField,
  doc,
  getDoc,
  getDocsFromServer,
  runTransaction,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import {
  requireFirebaseAuth,
  requireFirestore,
} from "../lib/firebase";
import type {
  CloudCommissionerMember,
  CloudCommissionerSlotId,
  CloudDirectoryUser,
  CloudPoolInvite,
  CloudRole,
} from "../types/cloud";

interface StoredUser {
  uid?: unknown;
  displayName?: unknown;
  email?: unknown;
}

interface StoredAdmin {
  role?: unknown;
  displayName?: unknown;
  email?: unknown;
  slot?: unknown;
}


interface StoredInvite {
  displayName?: unknown;
  email?: unknown;
  status?: unknown;
  sentAt?: unknown;
  sentByName?: unknown;
  linkedUid?: unknown;
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function cleanName(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function requireCurrentUser() {
  const user = requireFirebaseAuth().currentUser;

  if (!user) {
    throw new Error("Sign in to Firebase first.");
  }

  return user;
}

async function getRole(uid: string): Promise<CloudRole> {
  const snapshot = await getDoc(
    doc(requireFirestore(), "admins", uid),
  );

  if (!snapshot.exists()) {
    return "player";
  }

  return snapshot.data().role === "co_commissioner"
    ? "co_commissioner"
    : "primary_commissioner";
}

async function requireCommissioner(): Promise<CloudRole> {
  const user = requireCurrentUser();
  const role = await getRole(user.uid);

  if (role === "player") {
    throw new Error("Commissioner access is required.");
  }

  return role;
}

async function requirePrimary(): Promise<void> {
  const role = await requireCommissioner();

  if (role !== "primary_commissioner") {
    throw new Error(
      "Only the Primary Commissioner can assign backup commissioners.",
    );
  }
}

function validSlot(
  value: string,
): value is CloudCommissionerSlotId {
  return value === "backup1" || value === "backup2";
}

function mapMember(
  uid: string,
  userData: StoredUser | undefined,
  adminData: StoredAdmin | undefined,
  slot: "primary" | CloudCommissionerSlotId,
): CloudCommissionerMember {
  return {
    uid,
    display_name: asString(
      userData?.displayName,
      asString(adminData?.displayName, "Commissioner"),
    ),
    email: asString(
      userData?.email,
      asString(adminData?.email),
    ),
    role:
      slot === "primary"
        ? "primary_commissioner"
        : "co_commissioner",
    slot,
  };
}

export async function fetchCloudCommissionerTeam(): Promise<{
  users: CloudDirectoryUser[];
  invites: CloudPoolInvite[];
  primary: CloudCommissionerMember | null;
  backups: Record<
    CloudCommissionerSlotId,
    CloudCommissionerMember | null
  >;
}> {
  const currentRole = await requireCommissioner();
  const currentUser = requireCurrentUser();
  const db = requireFirestore();

  /*
   * Force fresh server reads for the commissioner directory. This avoids a
   * stale admins collection after the Primary record is corrected manually
   * in the Firebase console.
   */
  const [
    userSnapshots,
    adminSnapshots,
    inviteSnapshots,
    currentUserSnapshot,
    currentAdminSnapshot,
  ] = await Promise.all([
    getDocsFromServer(collection(db, "users")),
    getDocsFromServer(collection(db, "admins")),
    getDocsFromServer(collection(db, "invites")),
    getDoc(doc(db, "users", currentUser.uid)),
    getDoc(doc(db, "admins", currentUser.uid)),
  ]);

  const usersByUid = new Map<string, StoredUser>();
  const adminsByUid = new Map<string, StoredAdmin>();

  userSnapshots.forEach((snapshot) => {
    usersByUid.set(snapshot.id, snapshot.data() as StoredUser);
  });

  adminSnapshots.forEach((snapshot) => {
    adminsByUid.set(snapshot.id, snapshot.data() as StoredAdmin);
  });

  const users: CloudDirectoryUser[] = userSnapshots.docs
    .map((snapshot) => {
      const data = snapshot.data() as StoredUser;
      const admin = adminsByUid.get(snapshot.id);
      const role: CloudRole =
        admin?.role === "primary_commissioner"
          ? "primary_commissioner"
          : admin?.role === "co_commissioner"
            ? "co_commissioner"
            : "player";

      return {
        uid: snapshot.id,
        display_name: asString(data.displayName, "Player"),
        email: asString(data.email),
        role,
      };
    })
    .sort((a, b) =>
      a.display_name.localeCompare(b.display_name),
    );

  /*
   * Prefer an explicitly marked Primary Commissioner. Older manually-created
   * admin records are also accepted when they are not backup records.
   */
  const primaryEntry = [...adminsByUid.entries()].find(
    ([, data]) =>
      data.role === "primary_commissioner" ||
      (data.role !== "co_commissioner" && !asString(data.slot)),
  );

  let primary = primaryEntry
    ? mapMember(
        primaryEntry[0],
        usersByUid.get(primaryEntry[0]),
        primaryEntry[1],
        "primary",
      )
    : null;

  /*
   * Jimbo's authenticated admin document is authoritative. If the collection
   * result does not include it, use the directly-read record so the Primary
   * card and backup-assignment controls still work.
   */
  if (
    !primary &&
    currentRole === "primary_commissioner" &&
    currentAdminSnapshot.exists()
  ) {
    const currentAdmin =
      currentAdminSnapshot.data() as StoredAdmin;
    const currentUserData: StoredUser = currentUserSnapshot.exists()
      ? (currentUserSnapshot.data() as StoredUser)
      : {
          uid: currentUser.uid,
          displayName:
            asString(currentAdmin.displayName) ||
            currentUser.displayName ||
            "Primary Commissioner",
          email:
            asString(currentAdmin.email) ||
            currentUser.email ||
            "",
        };

    primary = mapMember(
      currentUser.uid,
      currentUserData,
      currentAdmin,
      "primary",
    );
  }

  const backups: Record<
    CloudCommissionerSlotId,
    CloudCommissionerMember | null
  > = {
    backup1: null,
    backup2: null,
  };

  adminsByUid.forEach((adminData, uid) => {
    if (
      adminData.role !== "co_commissioner" ||
      !validSlot(asString(adminData.slot))
    ) {
      return;
    }

    const slot = asString(
      adminData.slot,
    ) as CloudCommissionerSlotId;

    backups[slot] = mapMember(
      uid,
      usersByUid.get(uid),
      adminData,
      slot,
    );
  });

  const linkedUidByEmail = new Map(
    users.map((user) => [normalizeEmail(user.email), user.uid]),
  );
  const invites: CloudPoolInvite[] = inviteSnapshots.docs
    .map((snapshot) => {
      const data = snapshot.data() as StoredInvite;
      const email = normalizeEmail(asString(data.email));
      const linkedUid =
        asString(data.linkedUid) ||
        linkedUidByEmail.get(email) ||
        null;

      const status: CloudPoolInvite["status"] =
        data.status === "signed_in" || linkedUid
          ? "signed_in"
          : "pending";

      return {
        id: snapshot.id,
        display_name: asString(data.displayName, "Player"),
        email,
        status,
        sent_at: asString(data.sentAt),
        sent_by_name: asString(
          data.sentByName,
          "Commissioner",
        ),
        linked_uid: linkedUid,
      };
    })
    .sort((a, b) => b.sent_at.localeCompare(a.sent_at));

  return { users, invites, primary, backups };
}

async function sendInviteEmail(
  inviteId: string,
  email: string,
): Promise<void> {
  const auth = requireFirebaseAuth();
  const url = new URL(
    `${window.location.origin}${import.meta.env.BASE_URL}`,
  );
  url.searchParams.set("invite", inviteId);

  await sendSignInLinkToEmail(auth, email, {
    url: url.toString(),
    handleCodeInApp: true,
  });
}

export async function createCloudPoolInvite(
  displayName: string,
  email: string,
): Promise<void> {
  await requireCommissioner();

  const cleanDisplayName = cleanName(displayName);
  const cleanEmail = normalizeEmail(email);

  if (
    cleanDisplayName.length < 2 ||
    cleanDisplayName.length > 40
  ) {
    throw new Error("Enter the player's name.");
  }

  if (!cleanEmail.includes("@")) {
    throw new Error("Enter a valid email address.");
  }

  const db = requireFirestore();
  const sender = requireCurrentUser();
  const senderProfile = await getDoc(
    doc(db, "users", sender.uid),
  );
  const senderName = senderProfile.exists()
    ? asString(senderProfile.data().displayName, "Commissioner")
    : "Commissioner";
  const inviteRef = doc(collection(db, "invites"));
  const sentAt = new Date().toISOString();

  await sendInviteEmail(inviteRef.id, cleanEmail);

  await setDoc(inviteRef, {
    displayName: cleanDisplayName,
    email: cleanEmail,
    roleRequested: "player",
    status: "pending",
    sentAt,
    sentByUid: sender.uid,
    sentByName: senderName,
  });

  await setDoc(doc(collection(db, "audit")), {
    actionType: "player_invite_sent",
    inviteId: inviteRef.id,
    invitedEmail: cleanEmail,
    invitedDisplayName: cleanDisplayName,
    commissionerUid: sender.uid,
    commissionerName: senderName,
    createdAt: sentAt,
  });
}

export async function resendCloudPoolInvite(
  inviteId: string,
): Promise<void> {
  await requireCommissioner();

  const db = requireFirestore();
  const inviteRef = doc(db, "invites", inviteId);
  const inviteSnapshot = await getDoc(inviteRef);

  if (!inviteSnapshot.exists()) {
    throw new Error("That invitation no longer exists.");
  }

  const data = inviteSnapshot.data() as StoredInvite;
  const email = normalizeEmail(asString(data.email));

  if (!email) {
    throw new Error("The invitation email is missing.");
  }

  await sendInviteEmail(inviteId, email);

  const sender = requireCurrentUser();
  const senderProfile = await getDoc(
    doc(db, "users", sender.uid),
  );
  const senderName = senderProfile.exists()
    ? asString(senderProfile.data().displayName, "Commissioner")
    : "Commissioner";
  const sentAt = new Date().toISOString();

  await updateDoc(inviteRef, {
    status: "pending",
    sentAt,
    sentByUid: sender.uid,
    sentByName: senderName,
    linkedUid: deleteField(),
    linkedAt: deleteField(),
  });
}

export async function assignCloudBackupCommissioner(
  slot: CloudCommissionerSlotId,
  uid: string,
): Promise<void> {
  await requirePrimary();

  if (!validSlot(slot)) {
    throw new Error("Choose Backup Commissioner 1 or 2.");
  }

  const db = requireFirestore();
  const primary = requireCurrentUser();
  const selectedUserRef = doc(db, "users", uid);
  const targetAdminRef = doc(db, "admins", uid);
  const auditRef = doc(collection(db, "audit"));
  const now = new Date().toISOString();

  /*
   * Backups are stored directly in admins/{uid}. The slot field identifies
   * Backup Commissioner 1 or 2. This removes the unnecessary second
   * commissionerSlots write that was being rejected by Firestore.
   */
  const adminSnapshots = await getDocsFromServer(
    collection(db, "admins"),
  );

  let previousUidForSlot = "";

  adminSnapshots.forEach((snapshot) => {
    const data = snapshot.data() as StoredAdmin;
    const existingSlot = asString(data.slot);

    if (
      data.role === "co_commissioner" &&
      existingSlot === slot &&
      snapshot.id !== uid
    ) {
      previousUidForSlot = snapshot.id;
    }

    if (
      data.role === "co_commissioner" &&
      existingSlot !== slot &&
      snapshot.id === uid
    ) {
      throw new Error(
        "That person is already assigned to the other backup slot.",
      );
    }
  });

  await runTransaction(db, async (transaction) => {
    const [selectedUserSnapshot, targetAdminSnapshot] =
      await Promise.all([
        transaction.get(selectedUserRef),
        transaction.get(targetAdminRef),
      ]);

    if (!selectedUserSnapshot.exists()) {
      throw new Error(
        "That person must sign in once before being assigned as a backup commissioner.",
      );
    }

    if (
      targetAdminSnapshot.exists() &&
      targetAdminSnapshot.data().role === "primary_commissioner"
    ) {
      throw new Error(
        "The Primary Commissioner cannot be assigned to a backup slot.",
      );
    }

    const userData = selectedUserSnapshot.data() as StoredUser;
    const displayName = asString(
      userData.displayName,
      "Backup Commissioner",
    );
    const email = asString(userData.email);

    if (previousUidForSlot) {
      transaction.delete(
        doc(db, "admins", previousUidForSlot),
      );
    }

    transaction.set(targetAdminRef, {
      role: "co_commissioner",
      displayName,
      email,
      slot,
      updatedAt: now,
    });

    transaction.set(auditRef, {
      actionType: "backup_commissioner_assigned",
      slot,
      affectedUid: uid,
      affectedDisplayName: displayName,
      affectedEmail: email,
      commissionerUid: primary.uid,
      createdAt: now,
    });
  });
}

export async function clearCloudBackupCommissioner(
  slot: CloudCommissionerSlotId,
): Promise<void> {
  await requirePrimary();

  if (!validSlot(slot)) {
    throw new Error("Choose a valid backup commissioner slot.");
  }

  const db = requireFirestore();
  const primary = requireCurrentUser();
  const auditRef = doc(collection(db, "audit"));
  const now = new Date().toISOString();
  const adminSnapshots = await getDocsFromServer(
    collection(db, "admins"),
  );

  const assigned = adminSnapshots.docs.find((snapshot) => {
    const data = snapshot.data() as StoredAdmin;

    return (
      data.role === "co_commissioner" &&
      asString(data.slot) === slot
    );
  });

  if (!assigned) {
    return;
  }

  const data = assigned.data() as StoredAdmin;
  const displayName = asString(
    data.displayName,
    "Backup Commissioner",
  );

  await runTransaction(db, async (transaction) => {
    transaction.delete(doc(db, "admins", assigned.id));
    transaction.set(auditRef, {
      actionType: "backup_commissioner_removed",
      slot,
      affectedUid: assigned.id,
      affectedDisplayName: displayName,
      commissionerUid: primary.uid,
      createdAt: now,
    });
  });
}
