/** A file size as people read it: decimal kB and MB. */
export function size(bytes) {
  if (bytes < 1000) return `${bytes} B`;
  if (bytes < 1e6) return `${(bytes / 1000).toFixed(bytes < 1e4 ? 1 : 0)} kB`;
  return `${(bytes / 1e6).toFixed(1)} MB`;
}

/** A path as a shell argument. */
export function quote(arg) {
  return /^[\w@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replace(/'/g, `'\\''`)}'`;
}
