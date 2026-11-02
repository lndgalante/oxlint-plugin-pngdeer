import { writeSync } from "node:fs";
import { isatty } from "node:tty";
import { count } from "./text.js";

// A batch's count, for fill()'s progress: rewrites its line on a terminal; elsewhere (CI logs), a
// line every 30 s, so a long first run doesn't look hung or trip a no-output limit (CircleCI's is 10
// minutes). Written straight to stderr, as the thread that would print it may be blocked waiting.
export function progressLine() {
  const tty = isatty(2);
  let last = Date.now();
  return (done, total) => {
    if (tty) return void writeSync(2, `\rpngdeer: measuring ${count(total, "image")}... ${done}/${total}\x1b[K`);
    if (Date.now() - last < 30_000) return;
    last = Date.now();
    writeSync(2, `pngdeer: measured ${done} of ${count(total, "image")}...\n`);
  };
}
