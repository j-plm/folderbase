import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import SettingsApp from "./components/settings/SettingsApp";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "./index.css";
import { suppressWebContextMenu } from "./lib/nativeMenu";
import { previewViewHide } from "./lib/commands";

suppressWebContextMenu();
// The Settings window runs this same page, showing its panes instead (settings_window.rs)
const isSettings = getCurrentWindow().label === "settings";
// A reload leaves the old page's live preview (a native view) over the window
if (!isSettings) void previewViewHide().catch(() => {});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>{isSettings ? <SettingsApp /> : <App />}</React.StrictMode>
);
