import { collection, doc, getDoc, getDocs, runTransaction } from "firebase/firestore";
import { requireFirestore, requireFirebaseAuth } from "../lib/firebase";
import { requireCloudPrimary } from "./cloudRoleService";
import { ERIN_ENTRY, MITCH_OWNER, TRANSFER_ID, TRANSFER_PATHS, stableJson,
  transferUpdates, validateTransfer, type TransferRecords } from "./entryTransferPlan";

export interface EntryTransferPreview { records: TransferRecords; fingerprint: string; preparedAt: string; }

async function fingerprint(records: TransferRecords) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(stableJson(records)));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function prepareErinTransfer(): Promise<EntryTransferPreview> {
  await requireCloudPrimary();
  const db = requireFirestore();
  const snapshots = await Promise.all(TRANSFER_PATHS.map((path) => getDoc(doc(db, path))));
  const records = Object.fromEntries(snapshots.filter((s) => s.exists()).map((s) => [s.ref.path, s.data()]));
  validateTransfer(records);
  const claims = await getDocs(collection(db, "claims"));
  if (claims.size !== 32 || claims.docs.some((s) =>
    (s.data().uid === ERIN_ENTRY && s.id !== "19") || (s.data().uid === MITCH_OWNER && s.id !== "24"))) {
    throw new Error("Claim count or ledger uniqueness changed. Stop and review the pool.");
  }
  if ((await getDoc(doc(db, "audit", TRANSFER_ID))).exists()) {
    throw new Error("This transfer already has an audit record. Verify its result instead of repeating it.");
  }
  return { records, fingerprint: await fingerprint(records), preparedAt: new Date().toISOString() };
}

export async function applyErinTransfer(preview: EntryTransferPreview, confirmation: string): Promise<void> {
  await requireCloudPrimary();
  if (confirmation !== "TRANSFER LINE 19 TO MITCH2") throw new Error("Enter the exact transfer confirmation.");
  if (Date.now() - Date.parse(preview.preparedAt) > 15 * 60_000) throw new Error("Preview expired. Prepare a fresh review.");
  if (await fingerprint(preview.records) !== preview.fingerprint) throw new Error("Preview fingerprint mismatch.");
  const db = requireFirestore();
  await runTransaction(db, async (tx) => {
    const snapshots = await Promise.all(TRANSFER_PATHS.map((path) => tx.get(doc(db, path))));
    const audit = await tx.get(doc(db, "audit", TRANSFER_ID));
    if (audit.exists()) throw new Error("Transfer was already applied. Refresh and verify.");
    const current = Object.fromEntries(snapshots.filter((s) => s.exists()).map((s) => [s.ref.path, s.data()]));
    validateTransfer(current);
    if (stableJson(current) !== stableJson(preview.records)) throw new Error("A reviewed record changed. Prepare a fresh review.");
    for (const [path, patch] of Object.entries(transferUpdates())) tx.update(doc(db, path), patch);
    tx.set(doc(db, "audit", TRANSFER_ID), {
      actionType: "entry_ownership_transferred", entryId: ERIN_ENTRY, lineId: "19",
      fromOwnerUid: ERIN_ENTRY, toOwnerUid: MITCH_OWNER, fromName: "Erin", toName: "Mitch2",
      verifiedEmail: "bball1112@msn.com", previewFingerprint: preview.fingerprint,
      beforeClaim: current["claims/19"], beforeIndex: current[`userClaims/${ERIN_ENTRY}`],
      createdAt: new Date().toISOString(), commissionerUid: requireFirebaseAuth().currentUser!.uid,
    });
  });
}

export async function verifyErinTransfer(preview: EntryTransferPreview): Promise<void> {
  await requireCloudPrimary();
  const db = requireFirestore();
  const expected = structuredClone(preview.records);
  for (const [path, patch] of Object.entries(transferUpdates())) Object.assign(expected[path], patch);
  const snapshots = await Promise.all(TRANSFER_PATHS.map((path) => getDoc(doc(db, path))));
  const actual = Object.fromEntries(snapshots.filter((s) => s.exists()).map((s) => [s.ref.path, s.data()]));
  if (stableJson(actual) !== stableJson(expected)) throw new Error("Post-transfer comparison requires review. Do not repeat the transfer.");
}

export async function rollbackErinTransfer(confirmation: string): Promise<void> {
  await requireCloudPrimary();
  if (confirmation !== "RESTORE ERIN LINE 19") throw new Error("Enter the exact rollback confirmation.");
  const db = requireFirestore();
  await runTransaction(db, async (tx) => {
    const auditRef = doc(db, "audit", TRANSFER_ID);
    const claimRef = doc(db, "claims/19");
    const indexRef = doc(db, "userClaims", ERIN_ENTRY);
    const [audit, claim, index] = await Promise.all([tx.get(auditRef), tx.get(claimRef), tx.get(indexRef)]);
    if (!audit.exists() || audit.data().rolledBackAt || !claim.exists() || !index.exists()) throw new Error("No active transfer is available to roll back.");
    const expectedPatch = { ownerUid: MITCH_OWNER, playerName: "Mitch2" };
    if (stableJson(claim.data()) !== stableJson({ ...audit.data().beforeClaim, ...expectedPatch })
      || stableJson(index.data()) !== stableJson({ ...audit.data().beforeIndex, ...expectedPatch })) {
      throw new Error("The transferred entry changed. Review it before rolling back.");
    }
    // Keep an explicit owner so the rules can require an atomic paired update.
    const patch = { ownerUid: ERIN_ENTRY, playerName: "Erin" };
    tx.update(claimRef, patch); tx.update(indexRef, patch);
    tx.update(auditRef, { rolledBackAt: new Date().toISOString(), rolledBackByUid: requireFirebaseAuth().currentUser!.uid });
  });
}
