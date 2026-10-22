import { parseDateAs } from "./patterns";
import { dateKey, formatDatePattern } from "./propertyTypes";

// Rule formulas: Notion-style functions for values a pattern can't describe.
// A formula only decides what a rule writes; nothing stays formula-driven.
//
//   slice(name, 3, 7)        before(name, "_")        upper({Code})
//   match(name, "(\d{4})")   date({Date}, "YYMMDD")   prop("Client") & "-" & {Code}
//
// Text is joined with &. Names: name (without extension), filename, ext, path,
// folder (the one the file is in), created, modified, kind, size. {Slot} is a
// value captured by the rule's pattern; prop("…") reads any column by its name.

export interface FormulaContext {
  name: string;
  filename: string;
  ext: string;
  path: string;
  folder: string;
  /** The file's folders, top first (for folder(n)). */
  folders: string[];
  created: string;
  modified: string;
  kind: string;
  size: string;
  slots: Record<string, string>;
  /** Any column's value by its header name: a property, or Created, Kind, Source Tags… */
  prop: (name: string) => string;
}

type Node =
  | { kind: "text"; value: string }
  | { kind: "slot"; name: string }
  | { kind: "ident"; name: string }
  | { kind: "call"; name: string; args: Node[] }
  | { kind: "join"; parts: Node[] };

type Token = { type: "str" | "num" | "ident" | "slot" | "punct"; value: string; at: number };

export class FormulaError extends Error {}

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) {
      i++;
    } else if (ch === '"' || ch === "'") {
      let j = i + 1;
      let value = "";
      while (j < src.length && src[j] !== ch) {
        // \" and \\ inside a string; other backslashes stay (regex escapes like \d)
        if (src[j] === "\\" && (src[j + 1] === ch || src[j + 1] === "\\")) {
          value += src[j + 1];
          j += 2;
        } else value += src[j++];
      }
      if (j >= src.length) throw new FormulaError("A text in quotes isn't closed");
      tokens.push({ type: "str", value, at: i });
      i = j + 1;
    } else if (ch === "{") {
      const close = src.indexOf("}", i);
      if (close === -1) throw new FormulaError("A “{” isn't closed");
      tokens.push({ type: "slot", value: src.slice(i + 1, close).trim(), at: i });
      i = close + 1;
    } else if (/[0-9]/.test(ch) || (ch === "-" && /[0-9]/.test(src[i + 1] ?? ""))) {
      let j = i + 1;
      while (j < src.length && /[0-9.]/.test(src[j])) j++;
      tokens.push({ type: "num", value: src.slice(i, j), at: i });
      i = j;
    } else if (/[A-Za-z_]/.test(ch)) {
      let j = i + 1;
      while (j < src.length && /[A-Za-z0-9_]/.test(src[j])) j++;
      tokens.push({ type: "ident", value: src.slice(i, j), at: i });
      i = j;
    } else if ("(),&".includes(ch)) {
      tokens.push({ type: "punct", value: ch, at: i });
      i++;
    } else {
      throw new FormulaError(`“${ch}” isn't understood here`);
    }
  }
  return tokens;
}

/** Parses a formula, or throws a FormulaError explaining what's wrong. */
export function parseFormula(src: string): Node {
  const tokens = tokenize(src);
  let pos = 0;
  const peek = () => tokens[pos];
  const expect = (value: string) => {
    const t = tokens[pos];
    if (!t || t.value !== value || t.type !== "punct") throw new FormulaError(`Expected “${value}”`);
    pos++;
  };

  const primary = (): Node => {
    const t = tokens[pos++];
    if (!t) throw new FormulaError("The formula ends too soon");
    if (t.type === "str" || t.type === "num") return { kind: "text", value: t.value };
    if (t.type === "slot") return { kind: "slot", name: t.value };
    if (t.type === "ident") {
      if (peek()?.value === "(" && peek()?.type === "punct") {
        pos++;
        const args: Node[] = [];
        if (!(peek()?.value === ")" && peek()?.type === "punct")) {
          args.push(join());
          while (peek()?.value === "," && peek()?.type === "punct") {
            pos++;
            args.push(join());
          }
        }
        expect(")");
        return { kind: "call", name: t.value.toLowerCase(), args };
      }
      return { kind: "ident", name: t.value.toLowerCase() };
    }
    if (t.value === "(") {
      const inner = join();
      expect(")");
      return inner;
    }
    throw new FormulaError(`“${t.value}” isn't expected here`);
  };

  const join = (): Node => {
    const parts = [primary()];
    while (peek()?.value === "&" && peek()?.type === "punct") {
      pos++;
      parts.push(primary());
    }
    return parts.length === 1 ? parts[0] : { kind: "join", parts };
  };

  if (tokens.length === 0) throw new FormulaError("The formula is empty");
  const node = join();
  if (pos < tokens.length) throw new FormulaError(`“${tokens[pos].value}” isn't expected here`);
  return node;
}

/** The functions, with how many arguments each takes. */
export const FORMULA_FUNCTIONS: Record<string, { args: [number, number]; help: string }> = {
  slice: { args: [2, 3], help: "slice(text, start, end): characters from start (0 is the first) up to end" },
  left: { args: [2, 2], help: "left(text, n): the first n characters" },
  right: { args: [2, 2], help: "right(text, n): the last n characters" },
  before: { args: [2, 2], help: "before(text, \"_\"): the text before the first “_”" },
  after: { args: [2, 2], help: "after(text, \"_\"): the text after the first “_”" },
  beforelast: { args: [2, 2], help: "beforeLast(text, \"_\"): the text before the last “_”" },
  afterlast: { args: [2, 2], help: "afterLast(text, \"_\"): the text after the last “_”" },
  match: { args: [2, 2], help: "match(text, \"regex\"): the first ( ) group, or the whole match" },
  replace: { args: [3, 3], help: "replace(text, \"regex\", \"with\"): every match replaced" },
  upper: { args: [1, 1], help: "upper(text)" },
  lower: { args: [1, 1], help: "lower(text)" },
  trim: { args: [1, 1], help: "trim(text): without spaces at either end" },
  date: { args: [2, 2], help: "date(text, \"YYMMDD\"): the text read as a date" },
  prop: { args: [1, 1], help: "prop(\"Client\"): any column's value on the file (a property, or Created, Kind, Source Tags…)" },
  folder: { args: [1, 1], help: "folder(1): the top folder; folder(-1): the folder the file is in" },
  year: { args: [1, 1], help: "year(created): the year of a date" },
  month: { args: [1, 1], help: "month(created): the month of a date, 01–12" },
  day: { args: [1, 1], help: "day(created): the day of a date, 01–31" },
  quarter: { args: [1, 1], help: "quarter(created): Q1–Q4" },
  formatdate: { args: [2, 2], help: "formatDate(created, \"MMM YYYY\"): a date written out (YYYY YY MMMM MMM MM M DD D dddd ddd)" },
};

const NAMES = ["name", "filename", "ext", "path", "folder", "created", "modified", "kind", "size"] as const;

/** A date in text (ISO, or with a time) as [year, month, day], or a FormulaError. */
function dateParts(text: string): [number, number, number] {
  const key = dateKey(text);
  if (!key) throw new FormulaError(`“${text}” isn't a date`);
  const [y, m, d] = key.split("-").map(Number);
  return [y, m, d];
}

function regexOf(pattern: string): RegExp {
  try {
    return new RegExp(pattern);
  } catch {
    throw new FormulaError(`“${pattern}” isn't a valid regular expression`);
  }
}

const toInt = (text: string, what: string) => {
  const n = Number(text);
  if (!Number.isInteger(n)) throw new FormulaError(`${what} must be a whole number`);
  return n;
};

function evaluate(node: Node, ctx: FormulaContext): string {
  switch (node.kind) {
    case "text":
      return node.value;
    case "slot": {
      if (!(node.name in ctx.slots)) throw new FormulaError(`The pattern has no {${node.name}}`);
      return ctx.slots[node.name];
    }
    case "ident": {
      if (!(NAMES as readonly string[]).includes(node.name)) {
        throw new FormulaError(`“${node.name}” isn't known; use ${NAMES.join(", ")}, or prop("Name")`);
      }
      return ctx[node.name as (typeof NAMES)[number]];
    }
    case "join":
      return node.parts.map((p) => evaluate(p, ctx)).join("");
    case "call": {
      const fn = FORMULA_FUNCTIONS[node.name];
      if (!fn) throw new FormulaError(`There's no function “${node.name}”`);
      const [min, max] = fn.args;
      if (node.args.length < min || node.args.length > max) throw new FormulaError(fn.help);
      const a = node.args.map((n) => evaluate(n, ctx));
      switch (node.name) {
        case "slice":
          return a[0].slice(toInt(a[1], "The start"), a[2] != null ? toInt(a[2], "The end") : undefined);
        case "left":
          return a[0].slice(0, toInt(a[1], "The count"));
        case "right": {
          const n = toInt(a[1], "The count");
          return n <= 0 ? "" : a[0].slice(-n);
        }
        case "before": {
          const i = a[0].indexOf(a[1]);
          return i === -1 ? "" : a[0].slice(0, i);
        }
        case "after": {
          const i = a[0].indexOf(a[1]);
          return i === -1 ? "" : a[0].slice(i + a[1].length);
        }
        case "beforelast": {
          const i = a[0].lastIndexOf(a[1]);
          return i === -1 ? "" : a[0].slice(0, i);
        }
        case "afterlast": {
          const i = a[0].lastIndexOf(a[1]);
          return i === -1 ? "" : a[0].slice(i + a[1].length);
        }
        case "match": {
          const m = regexOf(a[1]).exec(a[0]);
          return m ? (m[1] ?? m[0]) : "";
        }
        case "replace":
          return a[0].replace(new RegExp(regexOf(a[1]).source, "g"), a[2]);
        case "upper":
          return a[0].toUpperCase();
        case "lower":
          return a[0].toLowerCase();
        case "trim":
          return a[0].trim();
        case "date":
          return parseDateAs(a[0], a[1]) ?? "";
        case "prop":
          return ctx.prop(a[0]);
        case "folder": {
          const n = toInt(a[0], "The folder's position");
          const list = ctx.folders;
          return (n > 0 ? list[n - 1] : n < 0 ? list[list.length + n] : undefined) ?? "";
        }
        case "year":
          return String(dateParts(a[0])[0]);
        case "month":
          return String(dateParts(a[0])[1]).padStart(2, "0");
        case "day":
          return String(dateParts(a[0])[2]).padStart(2, "0");
        case "quarter":
          return `Q${Math.ceil(dateParts(a[0])[1] / 3)}`;
        case "formatdate": {
          const [y, m, d] = dateParts(a[0]);
          return formatDatePattern(new Date(y, m - 1, d), a[1]);
        }
      }
      return "";
    }
  }
}

/** A formula's result for one file ("" when there's nothing to write), or throws a FormulaError. */
export function runFormula(src: string, ctx: FormulaContext): string {
  return evaluate(parseFormula(src), ctx);
}

/** What's wrong with a formula's wording, or null if it reads correctly (it may still fail on a given file). */
export function formulaProblem(src: string): string | null {
  try {
    parseFormula(src);
    return null;
  } catch (e) {
    return e instanceof FormulaError ? e.message : String(e);
  }
}
