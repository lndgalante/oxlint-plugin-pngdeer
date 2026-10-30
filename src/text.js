import { relative, sep } from "node:path";

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

/** "1 image", "5 images". */
export function count(n, noun) {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

/** A path as a shell argument, for the shell of the platform it's printed on. */
export function quote(arg) {
  if (/^[\w@+=:,./-]+$/.test(arg)) return arg;
  // cmd.exe and PowerShell take double quotes but not single ones, and Windows names can't hold "
  return process.platform === "win32" ? `"${arg}"` : `'${arg.replace(/'/g, `'\\''`)}'`;
}
