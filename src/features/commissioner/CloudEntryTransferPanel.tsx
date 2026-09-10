import { useState } from "react";
import { applyErinTransfer, prepareErinTransfer, verifyErinTransfer, rollbackErinTransfer, type EntryTransferPreview } from "../../services/cloudEntryTransferService";
import { ERIN_ENTRY, MITCH_OWNER } from "../../services/entryTransferPlan";

export function CloudEntryTransferPanel({ onComplete }: { onComplete: () => Promise<void> }) {
  const [preview, setPreview] = useState<EntryTransferPreview | null>(null);
  const [saved, setSaved] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [committed, setCommitted] = useState(false);
  const [rollbackConfirmation, setRollbackConfirmation] = useState("");
  const run = async (action: () => Promise<void>) => {
    setBusy(true); setMessage("");
    try { await action(); } catch (error) { setMessage(error instanceof Error ? error.message : "Transfer failed."); }
    finally { setBusy(false); }
  };
  return <section className="section-card">
    <h2>Transfer Erin’s entry to Mitch2</h2>
    <p>Line 19 keeps its existing 18-week schedule, ledger, and history. Mitch keeps line 24 and gains access to line 19. Erin loses access to line 19’s private schedule and payment records.</p>
    <button type="button" disabled={busy || committed} onClick={() => void run(async () => {
      setPreview(null); setSaved(false); setConfirmation("");
      setPreview(await prepareErinTransfer());
    })}>Review verified records</button>
    {preview && <>
      <dl>
        <dt>Erin · line 19 · existing ledger ID</dt><dd>{ERIN_ENTRY}</dd>
        <dt>Mitch · line 24 · new owner · bball1112@msn.com</dt><dd>{MITCH_OWNER}</dd>
        <dt>Line 19 paid balance</dt><dd>${Number(preview.records[`payments/${ERIN_ENTRY}`].amountPaidCents) / 100}</dd>
        <dt>Line 24 paid balance</dt><dd>${Number(preview.records[`payments/${MITCH_OWNER}`].amountPaidCents) / 100}</dd>
      </dl>
      <p>Only the name and owner fields on two claim records change. An audit record is added. Payment, scoring, schedule, and season records are never rewritten.</p>
      <button type="button" disabled={busy || committed} onClick={() => {
        const url = URL.createObjectURL(new Blob([JSON.stringify(preview, null, 2)], { type: "application/json" }));
        const link = document.createElement("a"); link.href = url; link.download = "33pool-erin-transfer-review.json";
        link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); setSaved(true);
      }}>Download transfer review and rollback records</button>
      <label>Type TRANSFER LINE 19 TO MITCH2
        <input disabled={busy || committed} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} />
      </label>
      <button type="button" disabled={busy || committed || !saved || confirmation !== "TRANSFER LINE 19 TO MITCH2"}
        onClick={() => void run(async () => {
          // Disable repetition even if verification encounters a network failure.
          setCommitted(true);
          await applyErinTransfer(preview, confirmation);
          await verifyErinTransfer(preview);
          await onComplete();
          setMessage("Verified: line 19 is Mitch2, both balances and schedules are unchanged, and Mitch controls both entries.");
        })}>Apply reviewed transfer</button>
      {committed && <button type="button" disabled={busy} onClick={() => void run(async () => {
        await verifyErinTransfer(preview); await onComplete(); setMessage("Transfer verified. Reviewed schedules, balances, and season state are unchanged.");
      })}>Verify transfer result</button>}
    </>}
    {message && <p role="status">{message}</p>}
    <details><summary>Restore Erin’s ownership if a transfer must be undone</summary>
      <p>Restores the entry name and owner from the verified transfer. Schedules and financial records remain untouched.</p>
      <label>Type RESTORE ERIN LINE 19<input value={rollbackConfirmation} disabled={busy}
        onChange={(event) => setRollbackConfirmation(event.target.value)} /></label>
      <button type="button" disabled={busy || rollbackConfirmation !== "RESTORE ERIN LINE 19"}
        onClick={() => void run(async () => {
          await rollbackErinTransfer(rollbackConfirmation); await onComplete();
          setRollbackConfirmation(""); setMessage("Erin’s line 19 ownership is restored. The rollback is recorded in the audit.");
        })}>Restore Erin’s ownership</button>
    </details>
  </section>;
}
