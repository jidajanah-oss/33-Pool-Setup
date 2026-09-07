import { useEffect, useRef, useState } from "react";

type Feedback = {
  message: string;
} | null;

const ACTION_WORDS =
  /\b(send|save|record|refresh|sync|generate|reset|rebuild|assign|remove|finalize|pull|run|load|calculate|clear|start|claim|verify|sign in|submit|update|create|delete|resend)\b/i;

function buttonLabel(button: HTMLButtonElement): string {
  return (button.textContent ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function workingMessage(label: string): string {
  if (/send|resend/i.test(label)) return "Sending?";
  if (/save|record/i.test(label)) return "Saving?";
  if (/refresh/i.test(label)) return "Refreshing?";
  if (/sync/i.test(label)) return "Syncing?";
  if (/generate|rebuild/i.test(label)) return "Generating?";
  if (/reset|clear|delete|remove/i.test(label)) return "Processing?";
  if (/claim/i.test(label)) return "Claiming?";
  if (/verify|sign in/i.test(label)) return "Verifying?";
  if (/load|pull/i.test(label)) return "Loading?";
  if (/submit/i.test(label)) return "Submitting?";
  if (/update|assign|finalize/i.test(label)) return "Updating?";
  return "Working?";
}

export function GlobalActionFeedback() {
  const [feedback, setFeedback] =
    useState<Feedback>(null);
  const clearTimer = useRef<number | null>(null);

  useEffect(() => {
    const clearExistingTimer = () => {
      if (clearTimer.current !== null) {
        window.clearTimeout(clearTimer.current);
        clearTimer.current = null;
      }
    };

    const handleClick = (event: MouseEvent) => {
      const target = event.target;

      if (!(target instanceof Element)) {
        return;
      }

      const button =
        target.closest<HTMLButtonElement>("button");

      if (!button || button.disabled) {
        return;
      }

      button.classList.remove(
        "action-feedback-pressed",
      );

      void button.offsetWidth;

      button.classList.add(
        "action-feedback-pressed",
      );

      window.setTimeout(() => {
        button.classList.remove(
          "action-feedback-pressed",
        );
      }, 180);

      const label = buttonLabel(button);

      if (!ACTION_WORDS.test(label)) {
        return;
      }

      clearExistingTimer();

      setFeedback({
        message: workingMessage(label),
      });

      const startedAt = performance.now();

      const watchButton = () => {
        const stillBusy =
          button.isConnected &&
          (
            button.disabled ||
            button.getAttribute("aria-busy") ===
              "true" ||
            (
            buttonLabel(button).endsWith("...") ||
            buttonLabel(button).endsWith("\u2026")
          )
          );

        if (stillBusy) {
          button.classList.add(
            "action-feedback-pending",
          );

          window.setTimeout(
            watchButton,
            120,
          );
          return;
        }

        button.classList.remove(
          "action-feedback-pending",
        );

        const elapsed =
          performance.now() - startedAt;
        const remaining =
          Math.max(0, 700 - elapsed);

        clearTimer.current =
          window.setTimeout(() => {
            setFeedback(null);
            clearTimer.current = null;
          }, remaining);
      };

      window.setTimeout(() => {
        if (
          button.disabled ||
          button.getAttribute("aria-busy") ===
            "true"
        ) {
          button.classList.add(
            "action-feedback-pending",
          );
        }

        watchButton();
      }, 40);
    };

    document.addEventListener(
      "click",
      handleClick,
      true,
    );

    return () => {
      document.removeEventListener(
        "click",
        handleClick,
        true,
      );
      clearExistingTimer();
    };
  }, []);

  if (!feedback) {
    return null;
  }

  return (
    <div
      aria-live="polite"
      className="global-action-feedback"
      role="status"
    >
      <span
        aria-hidden="true"
        className="global-action-feedback__spinner"
      />
      <strong>{feedback.message}</strong>
    </div>
  );
}
