import { useMemo, useRef, useState } from "react";
import type React from "react";
import { popoverField, popoverSelect } from "../../shared/Popover";
import { SymbolIcon } from "../../../lib/fileIcons";
import { FormulaError, FORMULA_FUNCTIONS, runFormula } from "../../../lib/formula";
import { DATE_FORMATS, compilePattern, isPatternError, matchPattern } from "../../../lib/patterns";
import { patternFor, patternMatch, type FilterRule } from "../../../lib/dbTable";
import { fileName } from "../../../lib/fileColumns";
import { valueToText } from "../../../lib/propertyTypes";
import { formulaContext, type PreviewRow, type RuleEnv } from "../../../lib/rules";
import type { FileRecord } from "../../../types";

const SLOT_ROWS: [string, string][] = [
  ["{Code}", "any text, picked out as Code"],
  ["{Code:4}", "exactly 4 characters"],
  ["{*}", "any text, not picked out"],
  ["{*:2}", "exactly 2 characters, not picked out"],
  ["{Code:digits}", "only digits 0–9 (as many as there are)"],
  ["{Code:4 digits}", "exactly 4 digits"],
  ["{Code:letters}", "only letters"],
  ["{Code:upper}", "only capital letters"],
  ["{Code:lower}", "only small letters"],
  ["{Code:alnum}", "letters and digits, no spaces or punctuation"],
];

const COMMON_PATTERNS: [string, string][] = [
  ["{*}invoice{*}", "“invoice” anywhere in it"],
  ["invoice{*}", "starts with “invoice”"],
  ["{*}_final", "ends with “_final” (before the extension)"],
  ["{Test:4 digits}-{Date:6 digits}", "0014-250701: a test number, a dash, a date"],
  ["{Date:digits}_{Person}", "250301_Ruben: digits, an underscore, the rest"],
  ["{Code:upper}{Num:digits}", "AB12: capitals then digits"],
  ["{*:digits}", "only digits, nothing else"],
  ["{Year:4 digits}-{Month:2}-{*}", "a date’s year and month (on Created, a Date…)"],
  ["{*}/{Client}/{*}", "the middle folder of a path"],
];

const FORMULA_NAMES: [string, string][] = [
  ["name", "the name without its extension"],
  ["filename", "the name with its extension"],
  ["ext · kind · size", "the extension, Kind and size in bytes"],
  ["path", "the path inside the location"],
  ["folder", "the folder the file is in"],
  ["created · modified", "dates, as 2025-03-01…"],
  ["{Slot}", "a value picked out by the rule’s pattern"],
  ['prop("Client")', "any column, by its header’s name"],
];

const FORMULA_EXAMPLES: [string, string][] = [
  ['upper(before(name, "_"))', "AB12 from ab12_final"],
  ['prop("Client") & "-" & year(created)', "Acme-2025"],
  ['match(name, "[0-9]{4}")', "the first 4 digits in a row"],
  ['date({Date} & {Time}, "YYYYMMDDHHmmss")', "a date and a time from two slots"],
];

/**
 * The Rules panel's reference: everything patterns and formulas can say, with
 * examples, and a box to try a pattern on a name before using it.
 */
const WIDTH_KEY = "rules-help-width";
const MIN_WIDTH = 300;

function savedWidth(): number {
  try {
    const n = Number(localStorage.getItem(WIDTH_KEY));
    return n >= MIN_WIDTH ? n : 400;
  } catch {
    return 400;
  }
}

export default function RulesHelp({ onClose }: { onClose: () => void }) {
  const [width, setWidth] = useState(savedWidth);
  const ref = useRef<HTMLElement>(null);

  // Drag the left edge to resize; it can grow to the whole of the panel beneath
  function startResize(e: React.MouseEvent) {
    e.preventDefault();
    const x0 = e.clientX;
    const start = ref.current?.offsetWidth ?? width;
    const max = ref.current?.parentElement?.clientWidth ?? window.innerWidth;
    let latest = start;
    const onMove = (ev: MouseEvent) => {
      latest = Math.round(Math.min(max, Math.max(MIN_WIDTH, start + x0 - ev.clientX)));
      setWidth(latest);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      try {
        localStorage.setItem(WIDTH_KEY, String(latest));
      } catch {
        // ignore
      }
    };
    document.body.style.cursor = "col-resize";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  return (
    <aside
      ref={ref}
      style={{ width }}
      className="absolute right-0 top-0 h-full max-w-full flex flex-col bg-neutral-900 border-l border-neutral-700/60 shadow-2xl z-20"
    >
      <div
        onMouseDown={startResize}
        title="Drag to resize"
        className="absolute left-0 top-0 h-full w-1.5 -translate-x-1/2 cursor-col-resize z-10"
        aria-hidden
      />
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-neutral-700/60 shrink-0">
        <h3 className="text-sm font-medium">Patterns and formulas</h3>
        <button onClick={onClose} aria-label="Close help" className="p-1.5 rounded hover:bg-neutral-800 text-neutral-400 hover:text-neutral-200">
          <SymbolIcon name="xmark" size={10} fallback="✕" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-5 text-body">
        <TryIt />

        <Section title="Patterns">
          <p className="text-neutral-400">
            A pattern is written like the text it matches, with <Code>{"{slots}"}</Code> where it varies. A slot with a name picks
            that part out so a rule can use it. Everything else must match exactly (capitals and small letters count as the same).
            The whole text has to fit; use <Code>{"{*}"}</Code> for parts you don’t care about.
          </p>
          <Table rows={SLOT_ROWS} />
          <p className="text-neutral-400">
            On a name, a pattern without a “.” ignores the extension. On a list such as Path Tags, any one folder that fits counts
            (or the one you choose beside the condition). Dates are written as <Code>2025-03-01</Code>.
          </p>
        </Section>

        <Section title="Common patterns">
          <Table rows={COMMON_PATTERNS} />
        </Section>

        <Section title="Reading a picked value">
          <p className="text-neutral-400">
            Beside a value taken from a pattern, choose how to read it: as it is, as a number, or as a date in one of these forms
            (letters stand for the year, month and day, and for a time HH the hour, mm the minutes, ss the seconds, SSS milliseconds;
            “(UTC)” at the end reads the time as UTC and shows it in local time):
          </p>
          <p className="font-mono text-[12px] text-neutral-300">{DATE_FORMATS.join("  ·  ")}</p>
          <p className="text-neutral-400">
            A slot named after one of these, like {"{YYMMDD}"}, is read that way by itself. A date with a time keeps it, so a
            camera’s <Code>IMG_20240301_101522.jpg</Code> read with <Code>IMG_{"{Taken:15}"}.jpg</Code> as YYYYMMDD_HHmmss gives
            1 March 2024 at 10:15, and sorts to the second. OneDrive names its camera uploads in UTC:{" "}
            <Code>20250610_094446600_iOS.heic</Code> is read with <Code>{"{Taken:18}"}_iOS</Code> as YYYYMMDD_HHmmssSSS (UTC). Date and time in two slots join in a formula:{" "}
            <Code>date({"{Date}"} &amp; {"{Time}"}, &quot;YYYYMMDDHHmmss&quot;)</Code>.
          </p>
        </Section>

        <Section title="Formulas">
          <p className="text-neutral-400">
            For anything a pattern can’t say. Text in quotes, joined with <Code>&amp;</Code>. Positions count from 0, as in Notion.
          </p>
          <Table rows={FORMULA_NAMES} />
          <Table rows={FUNCTION_ROWS} />
          <Table rows={FORMULA_EXAMPLES} />
        </Section>

        <Section title="From files with the same …">
          <p className="text-neutral-400">
            Fills a property from the other files that share a value. <Code>Rig</Code> from files with the same <Code>Test</Code>:
            where some files have Test 1 and Rig A1, files with Test 1 and no Rig get A1. Add more with And the Same… (same Test and
            Project), so Test 1 in two projects is kept apart.
          </p>
          <p className="text-neutral-400">
            Every file in the location teaches, whether or not it meets When. When can be left empty. Where files with the same values
            disagree (A1 on some, A2 on others), nothing is written and the preview says how many have each, so the odd ones can be
            put right by hand.
          </p>
        </Section>
      </div>
    </aside>
  );
}

const FUNCTION_ROWS = Object.values(FORMULA_FUNCTIONS).map((f) => splitHelp(f.help));

/** "slice(text, start, end): characters…" as [the call, what it does]. */
function splitHelp(help: string): [string, string] {
  const i = help.indexOf("): ");
  if (i !== -1) return [help.slice(0, i + 1), help.slice(i + 3)];
  return [help, ""];
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <p className="text-xs font-semibold text-neutral-400 uppercase tracking-wide">{title}</p>
      {children}
    </section>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return <code className="font-mono text-[12px] px-1 rounded bg-neutral-800 text-neutral-100">{children}</code>;
}

/** Code and what it does, a row each; with `onUse`, a row can be clicked to use its code. */
function Table({ rows, onUse }: { rows: [string, string][]; onUse?: (code: string) => void }) {
  return (
    <div className="rounded-md border border-neutral-700/60 overflow-hidden">
      {rows.map(([code, text], i) => (
        <div
          key={code}
          onClick={onUse && (() => onUse(code))}
          title={onUse ? "Use this" : undefined}
          className={`flex gap-3 px-2.5 py-1 ${i % 2 ? "bg-neutral-850" : ""} ${onUse ? "cursor-default hover:bg-blue-500/15" : ""}`}
        >
          <code className="font-mono text-[12px] text-neutral-100 w-[46%] shrink-0 break-all">{code}</code>
          <span className="text-neutral-400">{text}</span>
        </div>
      ))}
    </div>
  );
}

// ── Inline help, under the row it's about ────────────────────────────────────

function InlineHelp({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="ml-2 mt-1 mb-1 pl-3 border-l-2 border-neutral-600 flex flex-col gap-2 min-w-0 text-body">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-neutral-400 uppercase tracking-wide">{title}</p>
        <button type="button" onClick={onClose} className="h-6 px-2 rounded-[6px] text-neutral-400 hover:text-neutral-100 shrink-0">
          Done
        </button>
      </div>
      {children}
    </div>
  );
}

/** The fewest files a result line lists. */
const SHOWN = 3;

/**
 * Help for a "matches pattern" condition: how its pattern does on the files
 * (how many fit, what it picks out of a few), slot kinds, and common patterns
 * to start from.
 */
export function PatternHelp({
  condition,
  files,
  env,
  onUse,
  onClose,
}: {
  condition: FilterRule;
  files: FileRecord[];
  env: RuleEnv;
  onUse: (pattern: string) => void;
  onClose: () => void;
}) {
  const text = condition.value.trim();
  const compiled = text ? compilePattern(text) : null;
  const tried = useMemo(() => {
    const pattern = text ? patternFor(text) : null;
    if (!pattern) return null;
    const fits: { file: FileRecord; text: string; slots: Record<string, string> }[] = [];
    const misses: { file: FileRecord; text: string }[] = [];
    let withValue = 0;
    for (const f of files) {
      const value = env.valueOf(f, condition.column);
      if (value == null || value === "" || (Array.isArray(value) && value.length === 0)) continue;
      withValue++;
      const found = patternMatch(pattern, value, condition.item);
      if (found) fits.push({ file: f, ...found });
      else misses.push({ file: f, text: valueToText(value) });
    }
    return { fits, misses, withValue };
  }, [text, files, env, condition.column, condition.item]);

  return (
    <InlineHelp title="Pattern help" onClose={onClose}>
      <div className="rounded-md bg-neutral-850 px-2.5 py-1.5 font-mono text-[12px] flex flex-col gap-0.5">
        {!compiled ? (
          <span className="text-neutral-500">Type a pattern in the row, or click a common one below.</span>
        ) : isPatternError(compiled) ? (
          <span className="text-red-500">{compiled.error}</span>
        ) : tried ? (
          <>
            <span className={tried.fits.length ? "text-green-500" : "text-amber-500"}>
              {`Fits ${tried.fits.length.toLocaleString()} of ${tried.withValue.toLocaleString()} files`}
            </span>
            {tried.fits.slice(0, SHOWN).map((x) => (
              <span key={x.file.file_id} className="truncate" title={fileName(x.file.file_path)}>
                {x.text}
                <span className="text-neutral-500"> → </span>
                {Object.keys(x.slots).length === 0 ? (
                  <span className="text-neutral-500">fits</span>
                ) : (
                  Object.entries(x.slots).map(([k, v]) => (
                    <span key={k} className="mr-2">
                      <span className="text-neutral-400">{k}</span> {v}
                    </span>
                  ))
                )}
              </span>
            ))}
            {tried.misses.slice(0, SHOWN).map((x) => (
              <span key={x.file.file_id} className="truncate text-neutral-500" title={fileName(x.file.file_path)}>
                {x.text} <span className="text-amber-500">doesn’t fit</span>
              </span>
            ))}
          </>
        ) : null}
      </div>
      <p className="text-neutral-400">
        Written like the text it matches, with <Code>{"{slots}"}</Code> where it varies; the whole text has to fit. On a name, a
        pattern without a “.” ignores the extension.
      </p>
      <Table rows={SLOT_ROWS} />
      <p className="text-neutral-400 text-xs">Common patterns: click one to use it.</p>
      <Table rows={COMMON_PATTERNS} onUse={onUse} />
    </InlineHelp>
  );
}

/**
 * Help for a "from formula" value: the formula's result on a file meeting the
 * rule's conditions (any one of them can be chosen), the names and functions
 * it can use, and examples.
 */
export function FormulaHelp({
  formula,
  rows,
  env,
  onUse,
  onClose,
}: {
  formula: string;
  /** The preview's rows: the files meeting the conditions, with what their patterns picked out. */
  rows: PreviewRow[];
  env: RuleEnv;
  onUse: (formula: string) => void;
  onClose: () => void;
}) {
  const [fileId, setFileId] = useState<string | null>(null);
  const row = rows.find((r) => r.file.file_id === fileId) ?? rows[0];
  let result: { text: string } | { problem: string } | null = null;
  if (row && formula.trim()) {
    try {
      result = { text: runFormula(formula, formulaContext(row.file, row.slots, env)) };
    } catch (e) {
      result = { problem: e instanceof FormulaError ? e.message : String(e) };
    }
  }

  return (
    <InlineHelp title="Formula help" onClose={onClose}>
      <div className="flex items-center gap-1.5 min-w-0">
        <span className="text-neutral-400 shrink-0">Try on</span>
        <select
          value={row?.file.file_id ?? ""}
          onChange={(e) => setFileId(e.target.value)}
          disabled={rows.length === 0}
          className={`${popoverSelect} flex-1 min-w-0`}
        >
          {rows.length === 0 && <option value="">No file meets the conditions</option>}
          {rows.slice(0, 500).map((r) => (
            <option key={r.file.file_id} value={r.file.file_id}>
              {fileName(r.file.file_path)}
            </option>
          ))}
        </select>
      </div>
      <div className="rounded-md bg-neutral-850 px-2.5 py-1.5 font-mono text-[12px]">
        {!formula.trim() ? (
          <span className="text-neutral-500">Type a formula in the row, or click an example below.</span>
        ) : !result ? (
          <span className="text-neutral-500">No file to try it on</span>
        ) : "problem" in result ? (
          <span className="text-red-500">{result.problem}</span>
        ) : result.text === "" ? (
          <span className="text-amber-500">Empty: nothing would be written</span>
        ) : (
          <span className="text-green-500">{result.text}</span>
        )}
      </div>
      <p className="text-neutral-400">
        For anything a pattern can’t say. Text in quotes, joined with <Code>&amp;</Code>. Positions count from 0, as in Notion.
      </p>
      <Table rows={FORMULA_NAMES} />
      <Table rows={FUNCTION_ROWS} />
      <p className="text-neutral-400 text-xs">Examples: click one to use it.</p>
      <Table rows={FORMULA_EXAMPLES} onUse={onUse} />
    </InlineHelp>
  );
}

/** Type a name and a pattern (or a formula) and see what fits. */
function TryIt() {
  const [text, setText] = useState("0014-250701");
  const [pattern, setPattern] = useState("{Test:4 digits}-{Date:6 digits}");
  const compiled = pattern.trim() ? compilePattern(pattern.trim()) : null;
  const result = compiled && !isPatternError(compiled) ? matchPattern(compiled, text) : null;
  // upper(name)… is a formula, not a pattern
  const isFormula = !pattern.includes("{") && /^[a-z]+\(/i.test(pattern.trim());
  return (
    <Section title="Try a pattern">
      <label className="flex flex-col gap-1">
        <span className="text-neutral-400 text-xs">Text (a name, folder or value)</span>
        <input value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} className={`${popoverField} font-mono text-[12px]`} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-neutral-400 text-xs">Pattern</span>
        <input value={pattern} onChange={(e) => setPattern(e.target.value)} spellCheck={false} className={`${popoverField} font-mono text-[12px]`} />
      </label>
      <div className="rounded-md bg-neutral-850 px-2.5 py-1.5 font-mono text-[12px]">
        {!compiled ? (
          <span className="text-neutral-500">Type a pattern</span>
        ) : isPatternError(compiled) ? (
          <span className="text-red-500">{compiled.error}</span>
        ) : isFormula ? (
          <span className="text-neutral-400">That’s a formula: use it in Then set ▸ from formula.</span>
        ) : result ? (
          Object.keys(result).length === 0 ? (
            <span className="text-green-500">Fits (nothing picked out)</span>
          ) : (
            <span className="text-green-500">
              Fits:{" "}
              {Object.entries(result).map(([k, v]) => (
                <span key={k} className="mr-3">
                  <span className="text-neutral-400">{k}</span> {v}
                </span>
              ))}
            </span>
          )
        ) : (
          <span className="text-amber-500">Doesn’t fit</span>
        )}
      </div>
    </Section>
  );
}
