import { writeSync } from "node:fs";
import { isatty } from "node:tty";
import { count, size } from "./text.js";

/** Writes to stderr, unless the reader is gone (| head; EOF on Windows) or busy: the line goes unread, the work goes on. */
export function say(text) {
  try {
    writeSync(2, text);
  } catch (error) {
    if (!["EPIPE", "EOF", "EAGAIN"].includes(error.code)) throw error;
  }
}

/**
 * A line the next one rewrites with \r, written with the terminal's line wrap off (DECAWM): wider than
 * the terminal, it would wrap, and \r reaches back only to its last row, so each rewrite would leave a
 * row behind. It is cut at the margin instead. A terminal that doesn't know the mode ignores it.
 */
export function unwrapped(text) {
  return `\x1b[?7l${text}\x1b[?7h`;
}

/** fill()'s onStart: how many images go to the engine. On a terminal the count then rewrites this line. */
export function startLine(total) {
  const line = `pngdeer: measuring ${count(total, "image")} not in the cache yet...`;
  say(isatty(2) ? unwrapped(line) : `${line}\n`);
}

// A batch's count, for fill()'s progress, with what the images measured so far could save: rewrites
// its line on a terminal; elsewhere (CI logs), a line every 30 s, so a long first run doesn't look
// hung or trip a no-output limit (CircleCI's is 10 minutes). Written straight to stderr, as the
// thread that would print it may be blocked waiting.
export function progressLine() {
  const tty = isatty(2);
  let last = Date.now();
  let saved = 0;
  return (done, total, { saved: more = 0 } = {}) => {
    saved += more;
    // "could save", as a bare "smaller" reads as done and nothing has changed; never "flagged": it
    // counts images no code names, and ones a comment turns off
    const so = saved ? `, could save ${size(saved)} so far` : "";
    if (tty) return void say(unwrapped(`\rpngdeer: measuring ${count(total, "image")}... ${done}/${total}${so}\x1b[K`));
    // the last count is the caller's to tell ("measured 3 images in 2.1 s"): it would come right after
    // this one when a wait for another lint's lock used up the 30 s
    if (done === total || Date.now() - last < 30_000) return;
    last = Date.now();
    say(`pngdeer: measured ${done} of ${count(total, "image")}${so}...\n`);
  };
}
