import { useState } from "react";
import {
  createCloudBackup,
  downloadCloudBackup,
  downloadCloudRosterCsv,
  type CloudBackupExport,
} from "../../services/cloudBackupService";
import type { CloudRole } from "../../types/cloud";

function formatDate(value: string): string {
  if (!value) {
    return "Not created";
  }

  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString();
}

export function CloudBackupPanel({
  currentRole,
}: {
  currentRole: CloudRole;
}) {
  const [backup, setBackup] =
    useState<CloudBackupExport | null>(null);
  const [busy, setBusy] = useState<
    "backup" | "roster" | ""
  >("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const isPrimary = currentRole === "primary_commissioner";

  async function createAndDownload(
    type: "backup" | "roster",
  ) {
    setBusy(type);
    setMessage("");
    setError("");

    try {
      const nextBackup = await createCloudBackup();
      setBackup(nextBackup);

      if (type === "backup") {
        downloadCloudBackup(nextBackup);
        setMessage(
          "Complete Firebase backup downloaded successfully.",
        );
      } else {
        downloadCloudRosterCsv(nextBackup);
        setMessage(
          "Player and financial roster downloaded successfully.",
        );
      }
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The production export could not be created.",
      );
    } finally {
      setBusy("");
    }
  }

  return (
    <section className="section-card cloud-backup-panel">
      <div className="generator-heading">
        <div>
          <p className="eyebrow">Package 13</p>
          <h2>Production Backup & Audit Export</h2>
          <p>
            Save an offline copy before inviting more players,
            resetting the pull, or finalizing a week.
          </p>
        </div>
        <span className="generator-status">
          Primary only
        </span>
      </div>

      <div className="cloud-backup-actions">
        <button
          disabled={!isPrimary || Boolean(busy)}
          onClick={() => createAndDownload("backup")}
          type="button"
        >
          {busy === "backup"
            ? "Preparing Complete Backup…"
            : "Download Complete Backup"}
        </button>
        <button
          className="secondary-button"
          disabled={!isPrimary || Boolean(busy)}
          onClick={() => createAndDownload("roster")}
          type="button"
        >
          {busy === "roster"
            ? "Preparing Roster…"
            : "Download Player Roster CSV"}
        </button>
      </div>

      <div className="cloud-backup-summary">
        <div>
          <span>Last export</span>
          <strong>{formatDate(backup?.exported_at ?? "")}</strong>
        </div>
        <div>
          <span>Documents</span>
          <strong>
            {backup?.summary.document_count ?? "—"}
          </strong>
        </div>
        <div>
          <span>Claims</span>
          <strong>{backup?.summary.claim_count ?? "—"}</strong>
        </div>
        <div>
          <span>Payment entries</span>
          <strong>
            {backup?.summary.payment_transaction_count ?? "—"}
          </strong>
        </div>
      </div>

      {backup && (
        <div className="cloud-backup-checksum">
          <span>SHA-256 backup checksum</span>
          <code>{backup.checksum.value}</code>
        </div>
      )}

      {!isPrimary && (
        <div className="generator-message error">
          Only the Primary Commissioner can export the complete
          production database.
        </div>
      )}

      {message && (
        <div className="generator-message success">
          {message}
        </div>
      )}

      {error && (
        <div className="generator-message error">
          {error}
        </div>
      )}

      <p className="cloud-backup-note">
        Exporting does not modify Firebase. Keep the JSON backup in
        a private location because it contains player emails,
        schedules, payments, and commissioner records.
      </p>
    </section>
  );
}
