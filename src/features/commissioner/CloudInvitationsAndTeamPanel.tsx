import { useMemo, useState } from "react";
import type {
  CloudCommissionerSlotId,
  CloudCommissionerTeamState,
  CloudRole,
} from "../../types/cloud";

function roleLabel(role: CloudRole): string {
  if (role === "primary_commissioner") {
    return "Primary Commissioner";
  }

  if (role === "co_commissioner") {
    return "Backup Commissioner";
  }

  return "Player";
}

export function CloudInvitationsAndTeamPanel({
  currentRole,
  team,
}: {
  currentRole: CloudRole;
  team: CloudCommissionerTeamState;
}) {
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [selections, setSelections] = useState<
    Record<CloudCommissionerSlotId, string>
  >({
    backup1: "",
    backup2: "",
  });
  const isPrimary = currentRole === "primary_commissioner";

  const eligibleUsers = useMemo(() => {
    const assignedUids = new Set(
      Object.values(team.backups)
        .map((member) => member?.uid)
        .filter((uid): uid is string => Boolean(uid)),
    );

    return team.users.filter(
      (user) =>
        user.role !== "primary_commissioner" &&
        (!assignedUids.has(user.uid) ||
          Object.values(team.backups).some(
            (member) => member?.uid === user.uid,
          )),
    );
  }, [team.backups, team.users]);

  const run = async (
    id: string,
    action: () => Promise<void>,
    success: string,
  ) => {
    setBusy(id);
    setMessage("");
    setError("");

    try {
      await action();
      setMessage(success);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The Firebase commissioner action failed.",
      );
    } finally {
      setBusy("");
    }
  };

  const sendInvite = async () => {
    const targetEmail = email.trim().toLowerCase();

    await run(
      "invite",
      async () => {
        await team.sendInvite(displayName, email);
        setDisplayName("");
        setEmail("");
      },
      `Sign-in invitation sent to ${targetEmail}.`,
    );
  };

  const assign = async (slot: CloudCommissionerSlotId) => {
    const uid = selections[slot];

    if (!uid) {
      setError("Choose a signed-in person for that backup slot.");
      return;
    }

    const user = team.users.find((item) => item.uid === uid);

    await run(
      slot,
      () => team.assignBackup(slot, uid),
      `${user?.display_name ?? "User"} assigned as ${
        slot === "backup1"
          ? "Backup Commissioner 1"
          : "Backup Commissioner 2"
      }.`,
    );
  };

  return (
    <section className="section-card cloud-team-panel">
      <div className="generator-heading">
        <div>
          <p className="eyebrow">Player access</p>
          <h2>Invitations and Commissioner Team</h2>
          <p>
            Send Firebase sign-in links and maintain exactly one Primary
            Commissioner with up to two Backup Commissioners.
          </p>
        </div>
        <span className="generator-status locked">
          1 Primary · 2 Backups
        </span>
      </div>

      <div className="invite-form-grid">
        <label>
          Player name
          <input
            maxLength={40}
            onChange={(event) =>
              setDisplayName(event.target.value)
            }
            placeholder="First and last name"
            value={displayName}
          />
        </label>
        <label>
          Email address
          <input
            inputMode="email"
            onChange={(event) => setEmail(event.target.value)}
            placeholder="name@example.com"
            type="email"
            value={email}
          />
        </label>
        <button
          className="generator-primary"
          disabled={Boolean(busy)}
          onClick={() => void sendInvite()}
          type="button"
        >
          {busy === "invite"
            ? "Sending…"
            : "Send Firebase Sign-In Invite"}
        </button>
      </div>

      <p className="generator-note">
        The player opens the email link on their own device. Their invited
        name is used when their Firebase profile is created.
      </p>

      <div className="commissioner-team-grid">
        <article className="commissioner-role-card primary">
          <small>Primary Commissioner</small>
          <strong>
            {team.primary?.display_name ?? "Primary not found"}
          </strong>
          <span>
            {team.primary?.email || "Firebase admin record required"}
          </span>
          <b>Full control</b>
        </article>

        {(["backup1", "backup2"] as const).map((slot, index) => {
          const member = team.backups[slot];

          return (
            <article className="commissioner-role-card" key={slot}>
              <small>Backup Commissioner {index + 1}</small>
              <strong>{member?.display_name ?? "Unassigned"}</strong>
              <span>
                {member?.email ||
                  "Invite the person, have them sign in, then assign them here."}
              </span>

              {isPrimary ? (
                <>
                  <select
                    onChange={(event) =>
                      setSelections((current) => ({
                        ...current,
                        [slot]: event.target.value,
                      }))
                    }
                    value={selections[slot]}
                  >
                    <option value="">Choose signed-in user</option>
                    {eligibleUsers
                      .filter(
                        (user) =>
                          user.uid === member?.uid ||
                          !Object.values(team.backups).some(
                            (assigned) =>
                              assigned?.uid === user.uid &&
                              assigned.slot !== slot,
                          ),
                      )
                      .map((user) => (
                        <option key={user.uid} value={user.uid}>
                          {user.display_name} · {user.email} ·{" "}
                          {roleLabel(user.role)}
                        </option>
                      ))}
                  </select>
                  <div className="commissioner-slot-actions">
                    <button
                      disabled={Boolean(busy)}
                      onClick={() => void assign(slot)}
                      type="button"
                    >
                      {member ? "Replace" : "Assign"}
                    </button>
                    {member && (
                      <button
                        className="danger"
                        disabled={Boolean(busy)}
                        onClick={() => {
                          if (
                            window.confirm(
                              `Remove ${member.display_name} from Backup Commissioner ${index + 1}?`,
                            )
                          ) {
                            void run(
                              `clear-${slot}`,
                              () => team.clearBackup(slot),
                              `Backup Commissioner ${index + 1} cleared.`,
                            );
                          }
                        }}
                        type="button"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                </>
              ) : (
                <b>Primary Commissioner assigns this slot</b>
              )}
            </article>
          );
        })}
      </div>

      <div className="invite-list-heading">
        <div>
          <h3>Invitation Tracking</h3>
          <p>
            {team.invites.length} invitation
            {team.invites.length === 1 ? "" : "s"} recorded
          </p>
        </div>
        <button
          disabled={Boolean(busy) || team.loading}
          onClick={() =>
            void run(
              "refresh",
              team.refresh,
              "Invitation and commissioner status refreshed.",
            )
          }
          type="button"
        >
          Refresh
        </button>
      </div>

      {team.invites.length === 0 ? (
        <div className="empty-copy">
          No Firebase invitations have been sent yet.
        </div>
      ) : (
        <div className="cloud-invite-list">
          {team.invites.map((invite) => (
            <article key={invite.id}>
              <div>
                <strong>{invite.display_name}</strong>
                <span>{invite.email}</span>
                <small>
                  Sent{" "}
                  {invite.sent_at
                    ? new Date(invite.sent_at).toLocaleString()
                    : "date unavailable"}
                </small>
              </div>
              <div>
                <span
                  className={
                    invite.status === "signed_in"
                      ? "invite-linked"
                      : "invite-pending"
                  }
                >
                  {invite.status === "signed_in"
                    ? "Signed In"
                    : "Invite Pending"}
                </span>
                {invite.status === "pending" && (
                  <button
                    disabled={Boolean(busy)}
                    onClick={() =>
                      void run(
                        `resend-${invite.id}`,
                        () => team.resendInvite(invite.id),
                        `Invitation resent to ${invite.email}.`,
                      )
                    }
                    type="button"
                  >
                    Resend
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      )}

      {message && <div className="generator-message">{message}</div>}
      {(error || team.error) && (
        <div className="generator-message error">
          {error || team.error}
        </div>
      )}
    </section>
  );
}
