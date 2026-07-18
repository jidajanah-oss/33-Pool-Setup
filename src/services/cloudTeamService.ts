import { sendSignInLinkToEmail } from "firebase/auth";
import {
  collection,
  deleteField,
  doc,
  getDoc,
  getDocsFromServer,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import {
  requireFirebaseAuth,
  requireFirestore,
} from "../lib/firebase";
import {
  getCloudRoleForUid,
  PRIMARY_COMMISSIONER_UID,
  requireCloudCommissioner,
  requireCloudPrimary,
} from "./cloudRoleService";
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
  const currentRole = await requireCloudCommissioner();
  const currentUser = requireCurrentUser();
  const db = requireFirestore();

  const [
    userSnapshots,
    adminSnapshots,
    inviteSnapshots,
    currentUserSnapshot,
    teamSnapshot,
  ] = await Promise.all([
    getDocsFromServer(collection(db, "users")),
    getDocsFromServer(collection(db, "admins")),
    getDocsFromServer(collection(db, "invites")),
    getDoc(doc(db, "users", currentUser.uid)),
    getDoc(doc(db, "commissionerTeam", "main")),
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
      const teamData = teamSnapshot.exists()
        ? teamSnapshot.data()
        : {};
      const isBackup =
        asString(teamData.backup1Uid) === snapshot.id ||
        asString(teamData.backup2Uid) === snapshot.id;
      const role: CloudRole =
        snapshot.id === PRIMARY_COMMISSIONER_UID
          ? "primary_commissioner"
          : isBackup
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

  const primaryUser =
    usersByUid.get(PRIMARY_COMMISSIONER_UID) ??
    (currentUser.uid === PRIMARY_COMMISSIONER_UID &&
    currentUserSnapshot.exists()
      ? (currentUserSnapshot.data() as StoredUser)
      : undefined);

  const primaryAdmin = adminsByUid.get(
    PRIMARY_COMMISSIONER_UID,
  );

  const primary: CloudCommissionerMember = mapMember(
    PRIMARY_COMMISSIONER_UID,
    primaryUser ?? {
      uid: PRIMARY_COMMISSIONER_UID,
      displayName: "Jimbo",
      email: "jidajanah@gmail.com",
    },
    primaryAdmin,
    "primary",
  );

  const backups: Record<
    CloudCommissionerSlotId,
    CloudCommissionerMember | null
  > = {
    backup1: null,
    backup2: null,
  };

  let backup1Uid = teamSnapshot.exists()
    ? asString(teamSnapshot.data().backup1Uid)
    : "";
  let backup2Uid = teamSnapshot.exists()
    ? asString(teamSnapshot.data().backup2Uid)
    : "";
  const teamVersion = teamSnapshot.exists()
    ? Number(teamSnapshot.data().version)
    : 0;

  /*
   * One-time migration from the legacy co_commissioner admin records.
   * After version 2 is written, backup roles are controlled only by
   * commissionerTeam/main.
   */
  if (teamVersion !== 2 && currentRole === "primary_commissioner") {
    adminsByUid.forEach((adminData, uid) => {
      if (
        adminData.role === "co_commissioner" &&
        asString(adminData.slot) === "backup1" &&
        !backup1Uid
      ) {
        backup1Uid = uid;
      }

      if (
        adminData.role === "co_commissioner" &&
        asString(adminData.slot) === "backup2" &&
        !backup2Uid
      ) {
        backup2Uid = uid;
      }
    });

    await setDoc(
      doc(db, "commissionerTeam", "main"),
      {
        backup1Uid: backup1Uid || deleteField(),
        backup2Uid: backup2Uid || deleteField(),
        version: 2,
        updatedAt: new Date().toISOString(),
        updatedByUid: currentUser.uid,
      },
      { merge: true },
    );
  }

  if (backup1Uid) {
    backups.backup1 = mapMember(
      backup1Uid,
      usersByUid.get(backup1Uid),
      adminsByUid.get(backup1Uid),
      "backup1",
    );
  }

  if (backup2Uid) {
    backups.backup2 = mapMember(
      backup2Uid,
      usersByUid.get(backup2Uid),
      adminsByUid.get(backup2Uid),
      "backup2",
    );
  }

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
  await requireCloudCommissioner();

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
  await requireCloudCommissioner();

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
  await requireCloudPrimary();

  if (!validSlot(slot)) {
    throw new Error("Choose Backup Commissioner 1 or 2.");
  }

  const db = requireFirestore();
  const primary = requireCurrentUser();
  const selectedUserSnapshot = await getDoc(doc(db, "users", uid));

  if (!selectedUserSnapshot.exists()) {
    throw new Error(
      "That person must sign in once before being assigned as a backup commissioner.",
    );
  }

  const selectedRole = await getCloudRoleForUid(uid);

  if (uid === primary.uid || selectedRole === "primary_commissioner") {
    throw new Error(
      "The Primary Commissioner cannot be assigned to a backup slot.",
    );
  }

  const teamRef = doc(db, "commissionerTeam", "main");
  const teamSnapshot = await getDoc(teamRef);
  const teamData = teamSnapshot.exists() ? teamSnapshot.data() : {};
  const otherUid =
    slot === "backup1"
      ? asString(teamData.backup2Uid)
      : asString(teamData.backup1Uid);

  if (otherUid === uid) {
    throw new Error(
      "That person is already assigned to the other backup slot.",
    );
  }

  const fieldName =
    slot === "backup1" ? "backup1Uid" : "backup2Uid";

  await setDoc(
    teamRef,
    {
      [fieldName]: uid,
      version: 2,
      updatedAt: new Date().toISOString(),
      updatedByUid: primary.uid,
    },
    { merge: true },
  );

  try {
    await setDoc(doc(collection(db, "audit")), {
      actionType: "backup_commissioner_assigned",
      slot,
      affectedUid: uid,
      affectedDisplayName: asString(
        selectedUserSnapshot.data().displayName,
        "Backup Commissioner",
      ),
      affectedEmail: asString(selectedUserSnapshot.data().email),
      commissionerUid: primary.uid,
      createdAt: new Date().toISOString(),
    });
  } catch {
    // Team assignment remains authoritative.
  }
}

export async function clearCloudBackupCommissioner(
  slot: CloudCommissionerSlotId,
): Promise<void> {
  await requireCloudPrimary();

  if (!validSlot(slot)) {
    throw new Error("Choose a valid backup commissioner slot.");
  }

  const db = requireFirestore();
  const primary = requireCurrentUser();
  const teamRef = doc(db, "commissionerTeam", "main");
  const fieldName =
    slot === "backup1" ? "backup1Uid" : "backup2Uid";

  await setDoc(
    teamRef,
    {
      [fieldName]: deleteField(),
      version: 2,
      updatedAt: new Date().toISOString(),
      updatedByUid: primary.uid,
    },
    { merge: true },
  );

  try {
    await setDoc(doc(collection(db, "audit")), {
      actionType: "backup_commissioner_removed",
      slot,
      commissionerUid: primary.uid,
      createdAt: new Date().toISOString(),
    });
  } catch {
    // Team removal remains authoritative.
  }
}
