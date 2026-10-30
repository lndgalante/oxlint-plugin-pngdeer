/** A file size as people read it: decimal kB and MB. */
export function size(bytes) {
  if (bytes < 1000) return `${bytes} B`;
  if (bytes < 1e6) return `${(bytes / 1000).toFixed(bytes < 1e4 ? 1 : 0)} kB`;
  return `${(bytes / 1e6).toFixed(1)} MB`;
}

/** A path as a shell argument, for the shell of the platform it's printed on. */
export function quote(arg) {
  if (/^[\w@+=:,./-]+$/.test(arg)) return arg;
  // cmd.exe and PowerShell take double quotes but not single ones, and Windows names can't hold "
  return process.platform === "win32" ? `"${arg}"` : `'${arg.replace(/'/g, `'\\''`)}'`;
}
