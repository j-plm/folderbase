import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import SettingsApp from "./components/settings/SettingsApp";
import InfoApp from "./components/info/InfoApp";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "./index.css";
import { suppressWebContextMenu } from "./lib/nativeMenu";
import { previewViewHide } from "./lib/commands";

suppressWebContextMenu();
// The Settings, Get Info and Inspector windows run this same page, showing their own (settings_window.rs, info_window.rs)
const label = getCurrentWindow().label;
const isSettings = label === "settings";
const isInfo = label === "inspector" || label.startsWith("info-");
// A reload leaves the old page's live preview (a native view) over the window
if (!isSettings && !isInfo) void previewViewHide().catch(() => {});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>{isSettings ? <SettingsApp /> : isInfo ? <InfoApp /> : <App />}</React.StrictMode>
);
