import { useRef, useState } from "react";
import type React from "react";
import { popoverField } from "../../shared/Popover";
import { SymbolIcon } from "../../../lib/fileIcons";
import { FORMULA_FUNCTIONS } from "../../../lib/formula";
import { DATE_FORMATS, compilePattern, isPatternError, matchPattern } from "../../../lib/patterns";

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
          <Table
            rows={[
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
            ]}
          />
          <p className="text-neutral-400">
            On a name, a pattern without a “.” ignores the extension. On a list such as Source Tags, any one folder that fits counts
            (or the one you choose beside the condition). Dates are written as <Code>2025-03-01</Code>.
          </p>
        </Section>

        <Section title="Common patterns">
          <Table
            rows={[
              ["{*}invoice{*}", "“invoice” anywhere in it"],
              ["invoice{*}", "starts with “invoice”"],
              ["{*}_final", "ends with “_final” (before the extension)"],
              ["{Test:4 digits}-{Date:6 digits}", "0014-250701: a test number, a dash, a date"],
              ["{Date:digits}_{Person}", "250301_Ruben: digits, an underscore, the rest"],
              ["{Code:upper}{Num:digits}", "AB12: capitals then digits"],
              ["{*:digits}", "only digits, nothing else"],
              ["{Year:4 digits}-{Month:2}-{*}", "a date’s year and month (on Created, a Date…)"],
              ["{*}/{Client}/{*}", "the middle folder of a path"],
            ]}
          />
        </Section>

        <Section title="Reading a picked value">
          <p className="text-neutral-400">
            Beside a value taken from a pattern, choose how to read it: as it is, as a number, or as a date in one of these forms
            (letters stand for the year, month and day):
          </p>
          <p className="font-mono text-[12px] text-neutral-300">{DATE_FORMATS.join("  ·  ")}</p>
          <p className="text-neutral-400">A slot named after one of these, like {"{YYMMDD}"}, is read that way by itself.</p>
        </Section>

        <Section title="Formulas">
          <p className="text-neutral-400">
            For anything a pattern can’t say. Text in quotes, joined with <Code>&amp;</Code>. Positions count from 0, as in Notion.
          </p>
          <Table
            rows={[
              ["name", "the name without its extension"],
              ["filename", "the name with its extension"],
              ["ext · kind · size", "the extension, Kind and size in bytes"],
              ["path", "the path inside the location"],
              ["folder", "the folder the file is in"],
              ["created · modified", "dates, as 2025-03-01…"],
              ["{Slot}", "a value picked out by the rule’s pattern"],
            ]}
          />
          <Table rows={Object.values(FORMULA_FUNCTIONS).map((f) => splitHelp(f.help))} />
          <p className="text-neutral-400">
            For example: <Code>{'upper(before(name, "_"))'}</Code>, <Code>{'prop("Client") & "-" & year(created)'}</Code>,{" "}
            <Code>{'match(name, "[0-9]{4}")'}</Code> (the first 4 digits in a row).
          </p>
        </Section>
      </div>
    </aside>
  );
}

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

function Table({ rows }: { rows: [string, string][] }) {
  return (
    <div className="rounded-md border border-neutral-700/60 overflow-hidden">
      {rows.map(([code, text], i) => (
        <div key={code} className={`flex gap-3 px-2.5 py-1 ${i % 2 ? "bg-neutral-850" : ""}`}>
          <code className="font-mono text-[12px] text-neutral-100 w-[46%] shrink-0 break-all">{code}</code>
          <span className="text-neutral-400">{text}</span>
        </div>
      ))}
    </div>
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
