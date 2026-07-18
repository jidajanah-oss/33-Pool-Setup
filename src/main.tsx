import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import CloudApp from "./CloudApp";

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`)
      .then((registration) => {
        void registration.update();

        window.setInterval(() => {
          void registration.update();
        }, 60 * 60 * 1000);
      });
  });
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <CloudApp />
  </StrictMode>,
);
