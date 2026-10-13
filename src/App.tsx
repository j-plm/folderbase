import { useState, useEffect } from "react";
import Welcome from "./components/shell/Welcome";
import AppShell from "./components/shell/AppShell";
import { NavigationProvider } from "./contexts/NavigationContext";
import { getLibraries } from "./lib/commands";

type AppState = "loading" | "welcome" | "main";

export default function App() {
  const [appState, setAppState] = useState<AppState>("loading");

  useEffect(() => {
    getLibraries()
      .then((libs) => setAppState(libs.length === 0 ? "welcome" : "main"))
      .catch(() => setAppState("welcome"));
  }, []);

  if (appState === "loading") {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-950 text-gray-500 text-sm">
        Loading…
      </div>
    );
  }

  if (appState === "welcome") {
    return <Welcome onComplete={() => setAppState("main")} />;
  }

  return (
    <NavigationProvider>
      <AppShell />
    </NavigationProvider>
  );
}
