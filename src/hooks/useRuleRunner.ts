import { useEffect, useRef } from "react";
import { applyRuleWrites, getLocations, getProperties, getPropertyScopes, getRuleWrites, getRules } from "../lib/commands";
import { planRules } from "../lib/rules";
import { ruleEnv } from "../lib/ruleEnv";
import type { FileRecord } from "../types";

/** Let a burst of reloads (an edit, then the refresh it causes) settle before running. */
const SETTLE_MS = 400;

/**
 * Runs the library's enabled rules over the open location's files whenever
 * they load or change, in any view mode (spec ▸ Rules ▸ When rules run).
 * Rules only fill empty values and never rewrite their own, so the reload
 * after a run finds nothing more to do. Automatic runs aren't undoable.
 */
export function useRuleRunner(locationId: string | null, files: FileRecord[], refresh: () => Promise<unknown>) {
  const running = useRef(false);
  const again = useRef(false);

  useEffect(() => {
    if (!locationId || files.length === 0) return;
    const timer = window.setTimeout(() => {
      const run = async () => {
        if (running.current) {
          again.current = true;
          return;
        }
        running.current = true;
        try {
          const library = (await getLocations()).find((l) => l.location_id === locationId)?.library;
          if (!library) return;
          const rules = (await getRules(library)).filter((r) => r.enabled);
          if (rules.length === 0) return;
          const [registry, scopeRows, writes] = await Promise.all([
            getProperties(library),
            getPropertyScopes(library),
            getRuleWrites(library),
          ]);
          const { edits, writes: made } = planRules(rules, files, ruleEnv(registry, scopeRows, writes, library));
          if (edits.length === 0 && made.length === 0) return;
          await applyRuleWrites(edits, made);
          await refresh();
        } catch {
          // A failed background run is retried on the next change
        } finally {
          running.current = false;
          if (again.current) {
            again.current = false;
            void run();
          }
        }
      };
      void run();
    }, SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [locationId, files, refresh]);
}
