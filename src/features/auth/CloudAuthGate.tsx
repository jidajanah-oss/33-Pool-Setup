import { useState, type ReactNode } from "react";
import { OfficialLogo } from "../../components/OfficialLogo";
import type { CloudAuthController } from "./useCloudAuth";

export function CloudAuthGate({
  auth,
  children,
}: {
  auth: CloudAuthController;
  children: ReactNode;
}) {
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  if (auth.loading || (auth.session && !auth.profile)) {
    return (
      <div className="cloud-auth-shell">
        <section className="cloud-auth-card cloud-auth-loading">
          <OfficialLogo className="cloud-auth-logo" />
          <h1>Opening 33 Pool</h1>
          <p>Checking your secure Firebase session…</p>
        </section>
      </div>
    );
  }

  if (auth.session && auth.profile) return <>{children}</>;

  const sendLink = async () => {
    setSending(true);
    setError("");
    try {
      await auth.signInWithMagicLink(email, displayName);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The sign-in link could not be sent.");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="cloud-auth-shell">
      <section className="cloud-auth-card">
        <OfficialLogo className="cloud-auth-logo" />
        <p className="eyebrow">Secure player access</p>
        <h1>Sign in to 33 Pool</h1>
        <p className="cloud-auth-copy">
          Enter your name and email. We will send a secure sign-in link. Each account can claim only one schedule number.
        </p>

        <label>
          Player name
          <input
            autoComplete="name"
            maxLength={40}
            onChange={(event) => setDisplayName(event.target.value)}
            placeholder="First and last name"
            value={displayName}
          />
        </label>

        <label>
          Email address
          <input
            autoComplete="email"
            inputMode="email"
            onChange={(event) => setEmail(event.target.value)}
            placeholder="name@example.com"
            type="email"
            value={email}
          />
        </label>

        <button disabled={sending} onClick={() => void sendLink()} type="button">
          {sending ? "Sending…" : "Send Sign-In Link"}
        </button>

        {auth.magicLinkSentTo && (
          <div className="cloud-auth-success">
            Link sent to <strong>{auth.magicLinkSentTo}</strong>. Open the email on this device and tap the link.
          </div>
        )}
        {(error || auth.error) && <div className="cloud-auth-error">{error || auth.error}</div>}
      </section>
    </div>
  );
}
