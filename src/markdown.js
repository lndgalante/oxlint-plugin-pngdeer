// Markdown for a GitHub Actions job summary, which the lint's summary (summary.js) and --check
// (check.js) each write when GITHUB_STEP_SUMMARY names one.
import { appendFileSync, existsSync, statSync } from "node:fs";
import { isAbsolute } from "node:path";
import { physical } from "./scan.js";
import { pathFrom, printable } from "./text.js";

const REPORT_BYTES = 1024 * 1024; // GitHub drops a step's whole job summary past 1 MiB

/** A Markdown table: text columns to the left, numbers to the right. A | in a cell is escaped, even in code. */
export function table(header, rows) {
  const line = (cells) => `| ${cells.map((cell) => cell.replace(/\|/g, "\\|")).join(" | ")} |`;
  return [line(header), line(header.map((name) => (name === "Image" || name === "Where" ? "---" : "---:"))), ...rows.map(line)].join("\n");
}

/** Text as Markdown code: fenced past any backticks in it, with control characters, which would break a line or a table, replaced. */
export function code(text) {
  const plain = printable(text);
  const fence = "`".repeat(Math.max(0, ...(plain.match(/`+/g) ?? []).map((run) => run.length)) + 1);
  // Markdown takes one space off each end of code, which a space or backtick at either end needs
  const space = /^[ `]|[ `]$/.test(plain) ? " " : "";
  return `${fence}${space}${plain}${space}${fence}`;
}

/**
 * Text as it reads, with Markdown's marks escaped: a file name in it (Node's errors quote the path)
 * can't make a link, an image, HTML or emphasis.
 */
export function prose(text) {
  return printable(text).replace(/[\\`*_[\]()<>!~&$]/g, "\\$&");
}

/** A command in a block of its own, which GitHub gives a copy button. */
export function block(text) {
  return `\`\`\`\n${printable(text)}\n\`\`\``;
}

/**
 * The folder a summary names for a run in `cwd`: its path from the checkout (GITHUB_WORKSPACE), both
 * as the filesystem spells them, as a linter's cwd is, so a checkout reached through a link (macOS's
 * /var) still holds it. "" for the checkout itself, and outside it, where the path would only be a
 * long ../ chain.
 */
export function inCheckout(cwd) {
  const below = process.env.GITHUB_WORKSPACE ? pathFrom(physical(process.env.GITHUB_WORKSPACE), physical(cwd)) : "";
  return below === ".." || below.startsWith("../") || isAbsolute(below) ? "" : below;
}

export function capital(text) {
  return `${text[0].toUpperCase()}${text.slice(1)}`;
}

/** Adds `text` to the job summary, unless that would pass GitHub's limit and lose the step's whole summary. */
export function appendJobSummary(file, text) {
  const used = existsSync(file) ? statSync(file).size : 0;
  if (used + Buffer.byteLength(text) <= REPORT_BYTES) appendFileSync(file, text);
}
