import { relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

/** A file size as people read it: decimal kB and MB. */
export function size(bytes) {
  if (bytes < 1000) return `${bytes} B`;
  if (bytes < 1e6) return `${(bytes / 1000).toFixed(bytes < 1e4 ? 1 : 0)} kB`;
  return `${(bytes / 1e6).toFixed(1)} MB`;
}

/** How much smaller `after` bytes are than `before`, in whole percent. */
export function smaller(before, after) {
  return Math.round(100 - (100 * after) / before);
}

/** `file` as typed from `cwd`, with forward slashes on every platform. */
export function pathFrom(cwd, file) {
  return relative(cwd, file).split(sep).join("/");
}

/**
 * How a file at this SSIMULACRA2 score looks next to the original, after "looks", in the metric's
 * own terms: 90 can't be told apart even flipping between them, 80 not side by side, 70 shows
 * artifacts that aren't annoying.
 */
export function looks(score) {
  // the whole number people see (89.5 shows as 90), so the words match it
  const shown = Math.round(score);
  if (shown >= 90) return "identical";
  if (shown >= 80) return "the same side by side";
  if (shown >= 70) return "close, with differences you might spot side by side";
  return "visibly different";
}

/** "1 image", "5 images". */
export function count(n, noun) {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

/** A path as a shell argument, for the shell of the platform it's printed on. */
export function quote(arg, platform = process.platform) {
  if (arg.startsWith("-")) arg = `./${arg}`;
  const safe = platform === "win32" ? /^[\w+=:./-]+$/ : /^[\w@+=:,./-]+$/;
  if (safe.test(arg)) return arg;
  return platform === "win32" ? `'${arg.replace(/['\u2018-\u201b]/g, "$&$&")}'` : `'${arg.replace(/'/g, `'\\''`)}'`;
}

/** A runnable fix command; unusual Windows paths use PowerShell and bypass npm's batch shim. */
export function shrinkCommand(files, target, platform = process.platform) {
  const paths = files.map((file) => quote(file, platform));
  const powershell = platform === "win32" && paths.some((path) => path.startsWith("'"));
  // npx.cmd adds a cmd.exe parsing pass, which expands percent signs even inside quotes.
  const binary = fileURLToPath(new URL("../bin/pngdeer.js", import.meta.url));
  const runner = powershell ? `& ${quote(process.execPath, platform)} ${quote(binary, platform)}` : "npx oxlint-plugin-pngdeer";
  return { text: `${runner} ${paths.join(" ")}${target === undefined ? "" : ` --target ${target}`}`, shell: powershell ? " in PowerShell" : "" };
}
