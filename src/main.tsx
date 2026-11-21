import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { suppressWebContextMenu } from "./lib/nativeMenu";
import { previewViewHide } from "./lib/commands";

suppressWebContextMenu();
// A reload leaves the old page's live preview (a native view) over the window
void previewViewHide().catch(() => {});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
