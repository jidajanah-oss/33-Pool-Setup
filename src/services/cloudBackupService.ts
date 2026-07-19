import {
  collection,
  getDocs,
} from "firebase/firestore";
import {
  requireFirebaseAuth,
  requireFirestore,
} from "../lib/firebase";
import { requireCloudPrimary } from "./cloudRoleService";

type JsonPrimitive = string | number | boolean | null;
type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue };

interface BackupDocument {
  id: string;
  path: string;
  data: JsonValue;
}

interface BackupCollection {
  name: string;
  documents: BackupDocument[];
}

interface BackupSummary {
  collection_count: number;
  document_count: number;
  user_count: number;
  invitation_count: number;
  claim_count: number;
  payment_account_count: number;
  payment_transaction_count: number;
  finalized_week_count: number;
  winner_count: number;
  pull_archive_count: number;
}

export interface CloudBackupExport {
  format: "33-pool-cloud-backup";
  schema_version: 1;
  project_id: string;
  season: number;
  exported_at: string;
  exported_by: {
    uid: string;
    email: string;
  };
  checksum: {
    algorithm: "SHA-256";
    scope: "collections";
    value: string;
  };
  summary: BackupSummary;
  collections: BackupCollection[];
}

const TOP_LEVEL_COLLECTIONS = [
  "admins",
  "commissionerTeam",
  "invites",
  "users",
  "poolConfig",
  "claims",
  "userClaims",
  "privateSchedules",
  "weeklyPublic",
  "teamScores",
  "weeklyResults",
  "winners",
  "payments",
  "paymentTransactions",
  "audit",
  "pullArchives",
] as const;

const PULL_ARCHIVE_SUBCOLLECTIONS = [
  "state",
  "privateSchedules",
  "claims",
  "userClaims",
  "weeklyPublic",
  "teamScores",
] as const;

function normalizeValue(value: unknown): JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : String(value);
  }

  if (Array.isArray(value)) {
    return value.map(normalizeValue);
  }

  if (value && typeof value === "object") {
    const maybeTimestamp = value as {
      toDate?: () => Date;
    };

    if (typeof maybeTimestamp.toDate === "function") {
      return maybeTimestamp.toDate().toISOString();
    }

    const output: Record<string, JsonValue> = {};

    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .forEach(([key, nested]) => {
        output[key] = normalizeValue(nested);
      });

    return output;
  }

  return String(value);
}

function stableStringify(value: JsonValue): string {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }

  return `{${Object.keys(value)
    .sort()
    .map(
      (key) =>
        `${JSON.stringify(key)}:${stableStringify(value[key])}`,
    )
    .join(",")}}`;
}

async function sha256Hex(value: string): Promise<string> {
  const encoded = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", encoded);

  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function readCollection(
  name: string,
): Promise<BackupCollection> {
  const db = requireFirestore();
  const snapshots = await getDocs(collection(db, name));

  return {
    name,
    documents: snapshots.docs
      .map((snapshot) => ({
        id: snapshot.id,
        path: snapshot.ref.path,
        data: normalizeValue(snapshot.data()),
      }))
      .sort((left, right) => left.path.localeCompare(right.path)),
  };
}

async function readPullArchiveCollections(
  archiveIds: string[],
): Promise<BackupCollection[]> {
  const db = requireFirestore();
  const collections: BackupCollection[] = [];

  for (const archiveId of archiveIds) {
    for (const subcollection of PULL_ARCHIVE_SUBCOLLECTIONS) {
      const path = `pullArchives/${archiveId}/${subcollection}`;
      const snapshots = await getDocs(collection(db, path));

      if (snapshots.empty) {
        continue;
      }

      collections.push({
        name: path,
        documents: snapshots.docs
          .map((snapshot) => ({
            id: snapshot.id,
            path: snapshot.ref.path,
            data: normalizeValue(snapshot.data()),
          }))
          .sort((left, right) =>
            left.path.localeCompare(right.path),
          ),
      });
    }
  }

  return collections;
}

function collectionDocuments(
  collections: BackupCollection[],
  name: string,
): BackupDocument[] {
  return (
    collections.find((item) => item.name === name)?.documents ?? []
  );
}

function dataObject(
  document: BackupDocument | undefined,
): Record<string, JsonValue> {
  if (
    document?.data &&
    !Array.isArray(document.data) &&
    typeof document.data === "object"
  ) {
    return document.data;
  }

  return {};
}

function numberValue(value: JsonValue | undefined): number {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : 0;
}

function stringValue(value: JsonValue | undefined): string {
  return typeof value === "string" ? value : "";
}

function csvCell(value: string | number): string {
  const text = String(value);

  if (
    text.includes(",") ||
    text.includes('"') ||
    text.includes("\n")
  ) {
    return `"${text.replaceAll('"', '""')}"`;
  }

  return text;
}

function backupFilename(
  prefix: string,
  extension: string,
  exportedAt: string,
): string {
  const timestamp = exportedAt
    .replaceAll(":", "")
    .replaceAll(".", "-");

  return `${prefix}-${timestamp}.${extension}`;
}

function downloadText(
  filename: string,
  text: string,
  contentType: string,
): void {
  const blob = new Blob([text], { type: contentType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");

  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export async function createCloudBackup(): Promise<CloudBackupExport> {
  await requireCloudPrimary();

  const auth = requireFirebaseAuth();
  const db = requireFirestore();
  const user = auth.currentUser;

  if (!user) {
    throw new Error("Sign in to Firebase first.");
  }

  const topLevel = await Promise.all(
    TOP_LEVEL_COLLECTIONS.map(readCollection),
  );
  const pullArchiveIds = collectionDocuments(
    topLevel,
    "pullArchives",
  ).map((document) => document.id);
  const archivedCollections =
    await readPullArchiveCollections(pullArchiveIds);
  const collections = [...topLevel, ...archivedCollections].sort(
    (left, right) => left.name.localeCompare(right.name),
  );
  const poolConfig = dataObject(
    collectionDocuments(collections, "poolConfig").find(
      (document) => document.id === "main",
    ),
  );
  const season = numberValue(poolConfig.season) || 2026;
  const collectionValue = normalizeValue(collections);
  const checksum = await sha256Hex(
    stableStringify(collectionValue),
  );
  const documentCount = collections.reduce(
    (total, item) => total + item.documents.length,
    0,
  );

  return {
    format: "33-pool-cloud-backup",
    schema_version: 1,
    project_id:
      typeof db.app.options.projectId === "string"
        ? db.app.options.projectId
        : "pool-setup",
    season,
    exported_at: new Date().toISOString(),
    exported_by: {
      uid: user.uid,
      email: user.email ?? "",
    },
    checksum: {
      algorithm: "SHA-256",
      scope: "collections",
      value: checksum,
    },
    summary: {
      collection_count: collections.length,
      document_count: documentCount,
      user_count: collectionDocuments(collections, "users").length,
      invitation_count:
        collectionDocuments(collections, "invites").length,
      claim_count: collectionDocuments(collections, "claims").length,
      payment_account_count:
        collectionDocuments(collections, "payments").length,
      payment_transaction_count:
        collectionDocuments(
          collections,
          "paymentTransactions",
        ).length,
      finalized_week_count:
        collectionDocuments(collections, "weeklyResults").length,
      winner_count:
        collectionDocuments(collections, "winners").length,
      pull_archive_count: pullArchiveIds.length,
    },
    collections,
  };
}

export function downloadCloudBackup(
  backup: CloudBackupExport,
): void {
  downloadText(
    backupFilename(
      `33-pool-${backup.season}-cloud-backup`,
      "json",
      backup.exported_at,
    ),
    `${JSON.stringify(backup, null, 2)}\n`,
    "application/json;charset=utf-8",
  );
}

export function downloadCloudRosterCsv(
  backup: CloudBackupExport,
): void {
  const users = collectionDocuments(backup.collections, "users");
  const invites = collectionDocuments(backup.collections, "invites");
  const claims = collectionDocuments(
    backup.collections,
    "userClaims",
  );
  const payments = collectionDocuments(
    backup.collections,
    "payments",
  );
  const team = dataObject(
    collectionDocuments(
      backup.collections,
      "commissionerTeam",
    ).find((document) => document.id === "main"),
  );
  const claimsByUid = new Map(
    claims.map((document) => [
      document.id,
      dataObject(document),
    ]),
  );
  const paymentsByUid = new Map(
    payments.map((document) => [
      document.id,
      dataObject(document),
    ]),
  );
  const linkedInviteByUid = new Map<
    string,
    Record<string, JsonValue>
  >();

  invites.forEach((document) => {
    const data = dataObject(document);
    const uid = stringValue(data.linkedUid);

    if (uid) {
      linkedInviteByUid.set(uid, data);
    }
  });

  const rows = users.map((document) => {
    const user = dataObject(document);
    const claim = claimsByUid.get(document.id) ?? {};
    const payment = paymentsByUid.get(document.id) ?? {};
    const invite = linkedInviteByUid.get(document.id) ?? {};
    const scheduleNumber =
      numberValue(claim.lineId) ||
      numberValue(payment.scheduleNumber);
    const role =
      document.id === backup.exported_by.uid
        ? "Primary Commissioner"
        : stringValue(team.backup1Uid) === document.id
          ? "Backup Commissioner 1"
          : stringValue(team.backup2Uid) === document.id
            ? "Backup Commissioner 2"
            : "Player";

    return {
      scheduleNumber,
      playerName:
        stringValue(user.displayName) ||
        stringValue(payment.playerName) ||
        stringValue(invite.displayName) ||
        "Player",
      email:
        stringValue(user.email) || stringValue(invite.email),
      role,
      inviteStatus: stringValue(invite.status) || "No invite",
      amountPaid:
        numberValue(payment.amountPaidCents) / 100,
      seasonBalance:
        Math.max(
          0,
          numberValue(payment.seasonAmountDueCents) -
            numberValue(payment.amountPaidCents),
        ) / 100,
      winningsEarned:
        numberValue(payment.winningsEarnedCents) / 100,
      winningsPaid:
        numberValue(payment.winningsPaidCents) / 100,
    };
  });

  rows.sort((left, right) => {
    const leftNumber = left.scheduleNumber || 99;
    const rightNumber = right.scheduleNumber || 99;

    if (leftNumber !== rightNumber) {
      return leftNumber - rightNumber;
    }

    return left.playerName.localeCompare(right.playerName);
  });

  const header = [
    "Schedule Number",
    "Player Name",
    "Email",
    "Role",
    "Invitation Status",
    "Amount Paid",
    "Season Balance",
    "Winnings Earned",
    "Winnings Paid",
  ];
  const lines = [
    header.map(csvCell).join(","),
    ...rows.map((row) =>
      [
        row.scheduleNumber || "",
        row.playerName,
        row.email,
        row.role,
        row.inviteStatus,
        row.amountPaid.toFixed(2),
        row.seasonBalance.toFixed(2),
        row.winningsEarned.toFixed(2),
        row.winningsPaid.toFixed(2),
      ]
        .map(csvCell)
        .join(","),
    ),
  ];

  downloadText(
    backupFilename(
      `33-pool-${backup.season}-player-roster`,
      "csv",
      backup.exported_at,
    ),
    `${lines.join("\r\n")}\r\n`,
    "text/csv;charset=utf-8",
  );
}
