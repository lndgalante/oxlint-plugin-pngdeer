import { relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

/** A file size as people read it: decimal kB, MB and GB. */
export function size(bytes) {
  if (bytes < 1000) return `${bytes} B`;
  // the unit and decimals go by the number as it's printed, so 999,600 bytes read 1.0 MB, not 1000 kB
  const kB = bytes / 1000;
  if (Number(kB.toFixed(1)) < 10) return `${kB.toFixed(1)} kB`;
  if (Number(kB.toFixed(0)) < 1000) return `${kB.toFixed(0)} kB`;
  if (Number((bytes / 1e6).toFixed(1)) < 1000) return `${(bytes / 1e6).toFixed(1)} MB`;
  return `${(bytes / 1e9).toFixed(1)} GB`;
}

/**
 * How much smaller `after` bytes are than `before`, in whole percent: 100 only for nothing left, and
 * 0 only for no saving, as rounding would say of a file that keeps 0.3% of its bytes or saves 0.3%.
 */
export function smaller(before, after) {
  const percent = Math.round(100 - (100 * after) / before);
  return after > 0 && after < before ? Math.min(99, Math.max(1, percent)) : percent;
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

/** What the quality numbers mean, in looks()'s words, for a table that shows the numbers alone. */
export const LEGEND = "quality is SSIMULACRA2, out of 100: 90+ looks identical, 80+ the same side by side, 70+ close, with differences you might spot side by side, below 70 visibly different";

/** "1 image", "5 images". */
export function count(n, noun) {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

/**
 * A line for a terminal, with each control character in it (a file name's escape sequence or line
 * break, which would restyle the terminal or break the line) as U+FFFD, a character as wide.
 */
export function printable(text) {
  return text.replace(/\p{Cc}/gu, "\uFFFD");
}

/** A path as a shell argument, for the shell of the platform it's printed on. */
export function quote(arg, platform = process.platform) {
  return literal(arg.startsWith("-") ? `./${arg}` : arg, platform);
}

/** Any text as a shell argument, as quote() writes it. */
function literal(arg, platform) {
  // A control character would print as U+FFFD (printable()) and so name another file, maybe one left
  // out on purpose: each run of them goes as its bytes in $'\x..', which bash, zsh and ksh read (\x, as
  // the bash 3.2 macOS ships has no \u). Windows allows none below U+0020 in a name.
  if (platform !== "win32" && /\p{Cc}/u.test(arg)) {
    return arg.split(/(\p{Cc}+)/u).map((part, i) => (i % 2 ? `$'${Buffer.from(part).toString("hex").replace(/../g, "\\x$&")}'` : part && literal(part, platform))).join("");
  }
  // Windows takes / for \ in a path, and so do --exclude's patterns (scan.js): one typed with
  // backslashes then needs no quotes, and no quoted one ends in a \, which Windows PowerShell 5.1
  // passes on as escaping the quote it adds. No name there holds a \, so one typed there is a separator
  // in a command it prints for a POSIX shell too (a Windows runner's job summary).
  if (platform === "win32" || process.platform === "win32") arg = arg.replaceAll("\\", "/");
  // PowerShell reads an @ only at an argument's start, and cmd.exe never: logo@2x.png needs no
  // quotes. zsh reads an = there as a command's path (=x.png: "x.png not found").
  const safe = platform === "win32" ? /^[\w+=:./-][\w@+=:./-]*$/ : /^[\w@+:,./-][\w@+=:,./-]*$/;
  if (safe.test(arg)) return arg;
  return platform === "win32" ? `'${arg.replace(/['\u2018-\u201b]/g, "$&$&")}'` : `'${arg.replace(/'/g, `'\\''`)}'`;
}

/** A runnable fix command; unusual Windows paths use PowerShell and bypass npm's batch shim. */
export function shrinkCommand(files, target, platform = process.platform) {
  return command([], files, target, platform);
}

/**
 * The command that checks `paths` (files or folders), run the same way, with the check's options: the
 * ones that differ from the defaults, as given, as the check runs again from the same folder.
 */
export function checkCommand(paths, settings = {}, platform = process.platform) {
  return measuring(["--check"], paths, settings, platform);
}

/** The command that writes the review page (review.js) for `paths`, with the options as checkCommand() writes them. */
export function reviewCommand(paths, settings = {}, platform = process.platform) {
  return measuring(["--review"], paths, settings, platform);
}

function measuring(flags, paths, { target, exclude = [], cacheDir, minSavedBytes = 4096, minSavedPercent = 10 }, platform) {
  const options = [
    ...exclude.map((pattern) => ["--exclude", pattern]),
    ...(cacheDir === undefined ? [] : [["--cache-dir", cacheDir]]),
    ...(minSavedBytes === 4096 ? [] : [["--min-saved-bytes", String(minSavedBytes)]]),
    ...(minSavedPercent === 10 ? [] : [["--min-saved-percent", String(minSavedPercent)]]),
  ];
  return command(flags, paths, target, platform, options);
}

function command(flags, files, target, platform, options = []) {
  const args = [...files.map((file) => quote(file, platform)), ...options.flatMap(([option, value]) => [option, literal(value, platform)])];
  const powershell = platform === "win32" && args.some((arg) => arg.startsWith("'"));
  // npx.cmd adds a cmd.exe parsing pass, which expands percent signs even inside quotes.
  const binary = fileURLToPath(new URL("../bin/pngdeer.js", import.meta.url));
  const runner = powershell ? `& ${quote(process.execPath, platform)} ${quote(binary, platform)}` : "npx oxlint-plugin-pngdeer";
  return { text: `${[runner, ...flags, ...args].join(" ")}${target === undefined ? "" : ` --target ${target}`}`, shell: powershell ? " in PowerShell" : "" };
}
