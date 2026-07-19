import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { OfficialLogo } from "./components/OfficialLogo";

const CloudApp = lazy(() => import("./CloudApp"));

function StartupScreen() {
  return (
    <div className="startup-shell" role="status" aria-live="polite">
      <div className="startup-card">
        <OfficialLogo className="startup-logo" />
        <div className="startup-spinner" aria-hidden="true" />
        <strong>Opening 33 Pool</strong>
        <span>Connecting securely to Firebase…</span>
      </div>
    </div>
  );
}

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`)
      .then((registration) => {
        void registration.update();
        window.setInterval(() => void registration.update(), 60 * 60 * 1000);
      });
  });
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Suspense fallback={<StartupScreen />}>
      <CloudApp />
    </Suspense>
  </StrictMode>,
);
