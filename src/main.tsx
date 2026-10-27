import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { AttendanceProvider } from "./context/AttendanceContext";
import { AuthProvider } from "./context/AuthContext";
import { ConnectivityProvider } from "./context/ConnectivityContext";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <ConnectivityProvider>
        <AuthProvider>
          <AttendanceProvider>
            <App />
          </AttendanceProvider>
        </AuthProvider>
      </ConnectivityProvider>
    </BrowserRouter>
  </React.StrictMode>
);

// Offline cache for the app shell and face models (production build only, after one online visit).
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => { navigator.serviceWorker.register("/sw.js").catch(() => undefined); });
}
