import {
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { OfficialLogo } from "../../components/OfficialLogo";
import type { CloudAuthController } from "./useCloudAuth";

type AuthStep = "email" | "code";

export function CloudAuthGate({
  auth,
  children,
}: {
  auth: CloudAuthController;
  children: ReactNode;
}) {
  const [email, setEmail] = useState(auth.otpSentTo);
  const [displayName, setDisplayName] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<AuthStep>(
    auth.otpSentTo ? "code" : "email",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (auth.otpSentTo) {
      setEmail(auth.otpSentTo);
      setStep("code");
    }
  }, [auth.otpSentTo]);

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

  const requestCode = async () => {
    setBusy(true);
    setError("");
    setMessage("");

    try {
      await auth.requestOtp(email, displayName);
      setStep("code");
      setCode("");
      setMessage(
        "Verification code sent. Check your email, then enter the code here.",
      );
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The verification code could not be sent.",
      );
    } finally {
      setBusy(false);
    }
  };

  const useExistingCode = async () => {
    setBusy(true);
    setError("");
    setMessage("");

    try {
      await auth.prepareOtp(email, displayName);
      setStep("code");
      setCode("");
      setMessage(
        "Enter the verification code from your invitation email.",
      );
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The email and player name could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  };

  const verifyCode = async () => {
    setBusy(true);
    setError("");
    setMessage("");

    try {
      await auth.verifyOtp(auth.otpSentTo || email, code);
      setMessage("Code verified. Opening 33 Pool…");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The verification code could not be verified.",
      );
    } finally {
      setBusy(false);
    }
  };

  const resendCode = async () => {
    setBusy(true);
    setError("");
    setMessage("");

    try {
      await auth.requestOtp(
        auth.otpSentTo || email,
        displayName,
      );
      setCode("");
      setMessage("A new verification code was sent.");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "A new verification code could not be sent.",
      );
    } finally {
      setBusy(false);
    }
  };

  const useDifferentEmail = () => {
    auth.clearOtpRequest();
    setStep("email");
    setCode("");
    setMessage("");
    setError("");
  };

  return (
    <div className="cloud-auth-shell">
      <section className="cloud-auth-card">
        <OfficialLogo className="cloud-auth-logo" />

        {step === "email" ? (
          <>
            <p className="eyebrow">Secure in-app sign-in</p>
            <h1>Sign in to 33 Pool</h1>
            <p className="cloud-auth-copy">
              Enter your name and email. We will send a
              verification code that you enter inside this app.
            </p>

            <label>
              Player name
              <input
                autoComplete="name"
                disabled={busy}
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
                autoComplete="email"
                disabled={busy}
                inputMode="email"
                onChange={(event) =>
                  setEmail(event.target.value)
                }
                placeholder="name@example.com"
                type="email"
                value={email}
              />
            </label>

            <button
              disabled={busy}
              onClick={() => void requestCode()}
              type="button"
            >
              {busy
                ? "Sending Verification Code…"
                : "Send Verification Code"}
            </button>

            <button
              className="cloud-auth-secondary-button"
              disabled={busy}
              onClick={() => void useExistingCode()}
              type="button"
            >
              I Already Have a Code
            </button>
          </>
        ) : (
          <>
            <p className="eyebrow">Check your email</p>
            <h1>Enter your verification code</h1>
            <p className="cloud-auth-copy">
              Enter the 6-digit code sent to{" "}
              <strong>{auth.otpSentTo || email}</strong>.
              Stay inside this app while completing sign-in.
            </p>

            <label>
              Verification code
              <input
                aria-label="Verification code"
                autoComplete="one-time-code"
                autoFocus
                className="cloud-auth-code-input"
                disabled={busy}
                inputMode="numeric"
                maxLength={6}
                onChange={(event) =>
                  setCode(
                    event.target.value
                      .replace(/\D/g, "")
                      .slice(0, 6),
                  )
                }
                pattern="[0-9]*"
                placeholder="000000"
                type="text"
                value={code}
              />
            </label>

            <button
              disabled={busy || code.length !== 6}
              onClick={() => void verifyCode()}
              type="button"
            >
              {busy ? "Verifying Code…" : "Verify and Sign In"}
            </button>

            <button
              className="cloud-auth-secondary-button"
              disabled={busy}
              onClick={() => void resendCode()}
              type="button"
            >
              Resend Code
            </button>

            <button
              className="cloud-auth-text-button"
              disabled={busy}
              onClick={useDifferentEmail}
              type="button"
            >
              Use a Different Email
            </button>
          </>
        )}

        {message && (
          <div
            aria-live="polite"
            className="cloud-auth-success"
          >
            {message}
          </div>
        )}

        {(error || auth.error) && (
          <div
            aria-live="assertive"
            className="cloud-auth-error"
          >
            {error || auth.error}
          </div>
        )}
      </section>
    </div>
  );
}
