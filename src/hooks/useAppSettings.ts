import { useEffect, useSyncExternalStore } from "react";
import { appSettings } from "../lib/appSettings";

/** The app-wide settings, kept current as any window changes them (the defaults until read). */
export function useAppSettings() {
  useEffect(() => void appSettings.load(), []);
  return useSyncExternalStore(appSettings.subscribe, appSettings.snapshot).settings;
}
