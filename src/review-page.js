// The review page (review.js): one HTML file with its style and script inline, so it opens from disk
// with no server and makes no request. Every file name in it is hostile input: escaped in the HTML,
// percent-encoded in a URL, and in the script's data with "<" escaped, so a name can't end the block.
import { createHash } from "node:crypto";
import { FLOOR } from "./cache.js";
// the target --check suggests for the images the automatic target turned down, and how many of the
// biggest its command names; with a format, what it says of copies that wouldn't save enough
import { COMMAND_ROWS, LOWER, shortfall } from "./check.js";
import { FORMATS, own, sameText, SUGGESTED } from "./convert.js";
import { capital } from "./markdown.js";
import { apart, checkCommand, count, looks, pathFrom, quote, shrinkCommand, size, smaller } from "./text.js";

// Below this quality a difference may show side by side: the images worth a look first.
const REVIEW = 80;
// A command longer than this is split in two, and so on: cmd.exe takes at most 8191 characters, and
// npx's shim on Windows passes the arguments through it.
const LIMIT = 6000;
// From this many images, a list to jump from: below it, the cards are the list.
const LIST = 10;
// On every control, so the browser puts none of them back as they were: Chrome does that (going Back
// to the page, for one) after the script has started with every image ticked, and a box would then
// show unticked while the command still shrinks its image.
const UNSAVED = `autocomplete="off"`;
// What an AVIF page shows where a browser can't show its "after".
const UNSHOWN = "This browser can't show AVIF (Safari needs 16.4 or later).";

/**
 * The page for `cards` (biggest saving first), each one picture: { paths (its copies, the first
 * shown), before, after (URLs from the page's folder), width, height, alpha, original, compressed,
 * outcome, score (of one copy), target, total: { original, compressed } (of all copies) }; with the
 * command pieces for `platform`'s shell. `cwd` is where the command runs; `declined`, `missed` (each
 * with its target) and `errors` (as measureAll() gives them) are what isn't shown, and `settings` the
 * options to check them again. A card or missed image without a target of its own has `target`.
 *
 * With `format` ("webp", "avif"), each "after" is the image's copy in that format, and its card has
 * the image's `type`, its own shrink (`sameFormat`) and what that leaves (`base`), as measureAll()
 * gives them; `notWorthIt` (each with its target), `leftOut` and `existing` are the other images not
 * shown, and `cautions(show)` what to keep in mind before converting (check.js cautionsOf()). Without
 * one, `hint` ({ text, shell }) is the command that reviews the images as WebP, if the page offers it.
 */
export function page({ cwd, date, target, cards, declined = [], missed = [], errors = [], settings = {}, format, notWorthIt = [], leftOut = [], existing = [], cautions = () => [], hint = null }, platform = process.platform) {
  const targetOf = (item) => (Object.hasOwn(item, "target") ? item.target : target);
  // a lint's list may name images at several targets: each card says its own, and each gets a command
  const targets = [...new Set(cards.map(targetOf))];
  const mixed = targets.length > 1;
  const as = format ? FORMATS[format] : null;
  const data = scriptData(cards, targetOf, format, platform);
  const { images } = data;
  const on = images.map(() => true);
  const files = images.reduce((sum, image) => sum + image.count, 0);
  const original = images.reduce((sum, image) => sum + image.original, 0);
  const compressed = images.reduce((sum, image) => sum + image.compressed, 0);
  const headline = `${as ? `as ${as.name}, ` : ""}${count(files, "image")} could be ${size(original - compressed)} smaller`;
  const sum = `${size(original)} → ${size(compressed)}, ${smaller(original, compressed)}% smaller`;
  const style = `${STYLE}${as ? COPY_STYLE : ""}${cards.map((card, i) => `#image-${i} { --w: ${card.width}; --h: ${card.height}; --z: ${zoom(card).first || 1}; }`).join("\n")}\n`;
  // a page of copies says what its command writes, by the same names start() calls; an AVIF page
  // says where a browser can't show the copy
  const [tallied, instructed] = as ? [copyTally, copyInstruction] : [tally, instruction];
  const run = format === "avif" ? `{\n  start();\n  unshown(${JSON.stringify(UNSHOWN)});\n}` : "start();";
  const script = `"use strict";\n${[size, smaller, count, commands, tallied, instructed, unbroken, start, viewer, follow, copy, ...(format === "avif" ? [unshown] : [])].map(String).join("\n\n")}\n\nif (typeof document === "object") ${run}\n`;
  const { lines, shell } = commands(data, on);
  const lows = cards.filter(low).length;
  const several = cards.length > 1;
  const show = lows > 0 && lows < cards.length ? choice("show", "Show", [["all", "All"], ["low", `Quality below ${REVIEW} (${lows})`]]) : "";
  const backgrounds = cards.some(({ alpha }) => alpha) ? choice("bg", "Background", [["checks", "Checks"], ["white", "White"], ["black", "Black"]], " behind transparent images") : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' file:; style-src '${hash(style)}'; script-src '${hash(script)}'; base-uri 'none'; form-action 'none'">
<meta name="color-scheme" content="light dark">
<meta name="referrer" content="no-referrer">
<title>slimdeer review: ${escape(headline)}</title>
<style>${style}</style>
</head>
<body>
<a class="skip" href="#command">Skip to the command</a>
<header class="top">
<div class="lead">
<p class="tool">slimdeer review</p>
<h1>${escape(unbroken(capital(headline)))}</h1>
<p class="sum">${escape(unbroken(as ? `${sum}; shrunk in place at the same quality, ${files === 1 ? "it" : "they"} would be ${size(cards.reduce((total, card) => total + card.base * card.paths.length, 0))}` : sum))}</p>
<dl class="meta">
<div><dt>Folder</dt><dd><code>${escape(cwd)}</code></dd></div>
${as ? `<div><dt>Format</dt><dd>${as.name}, written next to ${files === 1 ? "the original" : "each original"}, which stays</dd></div>\n` : ""}${mixed ? `<div><dt>Targets</dt><dd>${eachTarget(cards, targetOf, as)}</dd></div>` : `<div><dt>Target</dt><dd>${targets[0] === undefined ? automatic(as, files) : `quality ${escape(targets[0])} (<code>--target ${escape(targets[0])}</code>)`}</dd></div>`}
<div><dt>Date</dt><dd>${escape(date)}</dd></div>
</dl>
${as ? cautioned(cautions) : ""}</div>
<div class="notes">
<details class="about" id="about" open><summary>What the numbers mean</summary>
<p>Quality is SSIMULACRA2, out of 100: 90+ looks identical, 80+ the same side by side, 70+ close, with differences you might spot side by side, below 70 visibly different.</p>
<p>${as ? about(as, files) : "Each “after” is the file the command writes, byte for byte. Nothing was uploaded, and no image file was changed."}</p>
${hint ? `<p>As WebP or AVIF? <code>${escape(hint.text)}</code>${hint.shell ? ", run in PowerShell," : ""} compares each image as WebP at the same quality as the file above. A new format means a new file name, so the code that uses the image has to change.</p>\n` : ""}</details>
${unlisted({ declined, missed, errors, notWorthIt, leftOut, existing, as, cwd, targetOf, settings }, platform)}
</div>
</header>
<main id="main">
<div class="tools">
<p class="how">Drag the divider to compare, or focus it and use the arrow keys. Fit can hide differences: 100% and 200% show the pixels.</p>
<div class="views">${show}${backgrounds}</div>
${several ? `<div class="bulk"><label class="all"><input ${UNSAVED} type="checkbox" id="all" checked> Tick all</label><button type="button" id="low"${lows ? "" : " disabled"}>Untick quality below ${REVIEW}</button></div>` : ""}
</div>
${cards.length >= LIST ? index(cards) : ""}
${cards.map((image, i) => card(image, i, targetOf(image), mixed, as)).join("\n")}
</main>
<section class="bar" aria-label="${as ? `Write the ticked images as ${as.name}` : "Shrink the ticked images"}">
<div class="bar-in">
<p id="tally" aria-live="polite">${escape(tallied(data, on))}</p>
<p class="say"><span id="say">${escape(instructed(files, lines.length, shell))}</span><span class="where"> in <code>${escape(cwd)}</code></span><span class="colon">:</span></p>
<div class="cmd"><pre id="command" tabindex="0" role="region" aria-label="Command">${escape(lines.join("\n"))}</pre><button type="button" id="copy">Copy</button></div>
${as ? `<p class="writes">${escape(writes(as, files, lines.length))}</p>\n` : ""}<p id="status" class="hidden" aria-live="polite"></p>
</div>
</section>
<script type="application/json" id="data">${JSON.stringify(data).replace(/</g, "\\u003c")}</script>
<script>${script}</script>
</body>
</html>
`;
}

/**
 * How many commands the page gives as it opens, every image ticked: one per target, and a long one
 * split. review.js says "command" or "commands" by it; its cards each have their target, and with
 * `format` the commands write copies in it.
 */
export function commandCount(cards, format, platform = process.platform) {
  const data = scriptData(cards, (card) => card.target, format, platform);
  return commands(data, data.images.map(() => true)).lines.length;
}

/**
 * What the page's script needs: the command's pieces, and each card's numbers, at `targetOf(card)`;
 * with `format`, its name, for the tally.
 */
function scriptData(cards, targetOf, format, platform) {
  const { args, ...runners } = pieces(cards.flatMap((card) => card.paths.map((path) => ({ path, target: targetOf(card) }))), format, platform);
  let next = 0;
  const images = cards.map((card) => {
    const own = args.slice(next, (next += card.paths.length));
    return { args: own.map(({ arg }) => arg), powershell: own.some(({ powershell }) => powershell), suffix: suffix(targetOf(card), format), count: card.paths.length, ...card.total, low: low(card) };
  });
  return { ...runners, limit: LIMIT, ...(format && { name: FORMATS[format].name }), images };
}

/** The Target row of a page at the automatic target: with a format, the target its copies aim at. */
function automatic(as, files) {
  if (!as) return `automatic, never below quality ${FLOOR}`;
  return `the quality ${files === 1 ? "the image's" : "each image's"} PNG or JPEG shrink would have (automatic, never below quality ${FLOOR})`;
}

/** What a page of copies in `as` ({ name }) says its "after" is, of `files` images. */
function about({ name }, files) {
  if (files === 1) return `The “after” is the ${name} file the command writes next to the original, byte for byte. Nothing was uploaded, and no image file was changed. The original stays; the code that names it has to change to use the new file.`;
  return `Each “after” is the ${name} file the command writes next to its original, byte for byte. Nothing was uploaded, and no image file was changed. The originals stay; the code that names them has to change to use the new files.`;
}

/**
 * What the command of a page of copies in `as` ({ extension }) does, under it, as it opens: `files`
 * images each written as a new file, in `lines` commands, and the code to change.
 */
function writes({ extension }, files, lines) {
  if (files === 1) return `It writes it as a new ${extension} file next to the original, which stays, then lists the lines of code that still name the original.`;
  return `${lines > 1 ? "They write" : "It writes"} each one as a new ${extension} file next to its original, which stays, then ${lines > 1 ? "list" : "lists"} the lines of code that still name the originals.`;
}

/**
 * The page's list of what to keep in mind before converting: `cautions(show)` (check.js
 * cautionsOf()) as sentences, each path in them as code.
 */
function cautioned(cautions) {
  const lines = cautions((path) => `<code>${escape(path)}</code>`);
  // their words are the package's own; only the paths come from the project
  return lines.length ? `<ul class="cautions">${lines.map((line) => `<li>${capital(line.slice("slimdeer: ".length))}.</li>`).join("")}</ul>\n` : "";
}

/**
 * The zoom a card opens at, and the enlargement it offers beyond 200%: a small icon opens enlarged up
 * to 256 px, its pixels as they are, where Fit would leave it under the divider's grip; a long strip
 * opens at 100%, to pan, where Fit would make it a sliver.
 */
function zoom({ width, height }) {
  const long = Math.max(width, height);
  const up = long > 0 && long < 128 ? Math.min(8, Math.floor(256 / long)) : 0;
  return { up, first: up || (long > 4 * Math.min(width, height) ? 1 : 0) };
}

/**
 * One card: its path (and its copies'), numbers, the comparison and the tick, at `target`, which it
 * names when the page is `mixed`; with `as` ({ name }), its "after" is the image's copy in that
 * format, set beside what the image's own shrink would do.
 */
function card(image, i, target, mixed, as) {
  const { paths: [path, ...copies], before, after, width, height, original, compressed, outcome, score } = image;
  const quality = outcome === "hit" ? `Quality ${Math.round(score)}/100: looks ${looks(score)}` : "Lossless: looks identical";
  const dot = ` <span class="dot" aria-hidden="true">·</span> `;
  const at = mixed ? `${dot}${target === undefined ? "automatic target" : `<code>--target ${escape(target)}</code>`}` : "";
  // as the command says it of the image's own shrink
  const shrink = as ? `${dot}${escape(unbroken(capital(sameText(image.sameFormat, original, target, image.type))))}` : "";
  // the numbers are one copy's, and the tick shrinks them all
  const each = copies.length ? " each" : "";
  const pick = as ? `Write ${copies.length ? `all ${copies.length + 1} ` : ""}as ${as.name}` : copies.length ? `Shrink all ${copies.length + 1}` : "Shrink this one";
  const { up, first } = zoom(image);
  const levels = [[0, "Fit"], [1, "100%"], [2, "200%"], ...(up > 2 ? [[up, `${up * 100}%`]] : [])];
  const img = (which, src, alt) => `<img class="${which}" src="${escape(src)}" width="${width}" height="${height}" alt="${escape(alt)}" loading="lazy" decoding="async" draggable="false">`;
  return `<article class="image${low(image) ? " low-card" : ""}" id="image-${i}" aria-labelledby="path-${i}">
<div class="head">
<h2 class="path" id="path-${i}">${escape(path)}</h2>
<label class="pick"><input ${UNSAVED} type="checkbox" checked aria-describedby="path-${i}"> ${pick}</label>
</div>
${copies.length ? `<p class="also">Also at ${copies.map((copy) => `<code>${escape(copy)}</code>`).join(", ")}</p>\n` : ""}<div class="facts">
<p>${escape(unbroken(`${smaller(original, compressed)}% smaller, ${size(original)} → ${size(compressed)}${each}`))}${dot}<span class="quality${low(image) ? " low" : ""}">${escape(quality)}</span>${at}${shrink}</p>
<fieldset class="choice zoom"><legend class="hidden">Zoom for ${escape(path)}</legend>
${levels.map(([value, label]) => `<label><input ${UNSAVED} type="radio" name="zoom-${i}" value="${value}"${value === first ? " checked" : ""}><span>${label}</span></label>`).join("")}
</fieldset>
</div>
<figure class="compare${first ? " zoomed" : ""}${first >= 2 ? " pixels" : ""}">
<div class="labels"><span>Before <b>${escape(size(original))}</b></span><span>After${as ? ` (${as.name})` : ""} <b>${escape(size(compressed))}</b></span></div>
<div class="view">
<div class="pan" role="group" aria-label="${escape(path)}, before and after"><div class="canvas">
${img("before", before, `${path}, before`)}
${img("after", after, `${path}, after: the ${as ? `${as.name} ` : ""}file the command writes`)}
</div></div>
<input ${UNSAVED} class="slider" type="range" min="0" max="100" step="1" value="50" aria-label="Divider for ${escape(path)}: before on its left, after on its right" aria-valuetext="50%">
<div class="divider" aria-hidden="true"><span class="grip"></span></div>
</div>
</figure>
</article>`;
}

/** A list of every card to jump to, biggest saving first, as a table. */
function index(cards) {
  const rows = cards.map((image, i) => {
    const { paths, original, compressed, outcome, score } = image;
    const copies = paths.length > 1 ? ` <span class="muted">(${paths.length} copies)</span>` : "";
    // one copy's numbers, as on its card
    const each = paths.length > 1 ? " each" : "";
    return `<tr${low(image) ? ` class="low-row"` : ""}><td><a href="#image-${i}">${escape(paths[0])}</a>${copies}</td><td>${escape(`${size(original - compressed)}${each}`)}</td><td class="size">${escape(`${size(original)} → ${size(compressed)}${each}`)}</td><td><span class="quality${low(image) ? " low" : ""}">${outcome === "hit" ? Math.round(score) : "lossless"}</span></td></tr>`;
  });
  return `<details class="index"><summary>Jump to an image</summary>
<table><thead><tr><th scope="col">Image</th><th scope="col">Saves</th><th scope="col" class="size">Size</th><th scope="col">Quality</th></tr></thead>
<tbody>
${rows.join("\n")}
</tbody></table>
</details>`;
}

/** A page-wide choice of radios named `name`, the first checked; `more` ends the legend for screen readers. */
function choice(name, legend, options, more = "") {
  const hidden = more ? `<span class="hidden">${escape(more)}</span>` : "";
  return `<fieldset class="group"><legend>${escape(legend)}${hidden}</legend><span class="choice">${options.map(([value, label], i) => `<label><input ${UNSAVED} type="radio" name="${name}" value="${value}"${i ? "" : " checked"}><span>${escape(label)}</span></label>`).join("")}</span></fieldset>`;
}

/**
 * What was measured but isn't on the page, each in a disclosure that names the images: with a format
 * (`as`), copies that wouldn't save enough beyond their image's own shrink (with the command that
 * shrinks those worth it, as --check gives), images with a file where their copy would go, and images
 * left out; those the automatic target turned down (with the command that tries them lower), those
 * that didn't reach the target, and those that couldn't be checked or previewed.
 */
function unlisted({ declined, missed, errors, notWorthIt, leftOut, existing, as, cwd, targetOf, settings }, platform) {
  const item = (path, text) => `<li><code>${escape(path)}</code>: ${escape(text)}</li>`;
  // rounded down, as --check says it: a miss's best is below its target
  const best = ({ path, score }) => item(path, `best quality ${Math.floor(score)}/100`);
  const biggest = (list) => [...list].sort((a, b) => b.original - a.original);
  const parts = as ? copyParts({ notWorthIt, leftOut, existing, as, cwd, targetOf, settings }, platform) : [];
  if (declined.length && as) {
    // as --check says it with a format: below the floor, there is no quality for a copy to match
    const one = declined.length === 1;
    const command = checkCommand(biggest(declined).slice(0, COMMAND_ROWS).map(({ path }) => path), { ...settings, target: SUGGESTED }, platform);
    parts.push([
      `${count(declined.length, "image")} ${one ? "isn't" : "aren't"} here: shrunk in place ${one ? "it doesn't" : "they don't"} reach quality ${FLOOR}, so there is no quality to match.`,
      `<ul>${biggest(declined).map(best).join("")}</ul>\n<p>To choose one${declined.length > COMMAND_ROWS ? ` for the ${COMMAND_ROWS} biggest` : ""}, run${command.shell}:</p>\n<pre>${escape(command.text)}</pre>`,
    ]);
  } else if (declined.length) {
    const one = declined.length === 1;
    const which = one ? "it" : declined.length > COMMAND_ROWS ? `the ${COMMAND_ROWS} biggest` : "them";
    const command = checkCommand(biggest(declined).slice(0, COMMAND_ROWS).map(({ path }) => path), { ...settings, target: LOWER }, platform);
    parts.push([
      `${count(declined.length, "image")} can't be made smaller without a visible difference (best quality below ${FLOOR}), so ${one ? "it isn't" : "they aren't"} here.`,
      `<ul>${biggest(declined).map(best).join("")}</ul>\n<p>To try ${which} at a lower target, run${command.shell}:</p>\n<pre>${escape(command.text)}</pre>`,
    ]);
  }
  if (missed.length && as) {
    // a copy aims at its target given, or at the quality of its image's own shrink: apart() keeps the
    // two numbers apart when they round alike, here against the best of the images that ask the same
    const asked = (image) => JSON.stringify([targetOf(image), targetOf(image) === undefined ? image.equal : null, image.type]);
    const top = (image) => Math.max(...missed.filter((other) => asked(other) === asked(image)).map(({ score }) => score));
    const wanted = (image) => (targetOf(image) === undefined ? `quality ${apart(image.equal, top(image))[0]}/100, the ${own(image.type)}'s` : `--target ${targetOf(image)}`);
    const reached = (image) => `best quality ${apart(image.equal, image.score)[1]}/100`;
    // one quality asked of them all is said once
    const one = new Set(missed.map(asked)).size === 1;
    const each = (image) => item(image.path, one ? reached(image) : `${reached(image)}, short of ${wanted(image)}`);
    parts.push([`${count(missed.length, "image")} ${missed.length === 1 ? "isn't" : "aren't"} here: as ${as.name}, no file reaches ${one ? wanted(missed[0]) : "the quality asked"}.`, `<ul>${biggest(missed).map(each).join("")}</ul>`]);
  } else if (missed.length) {
    const wanted = (target) => (target === undefined ? "the automatic quality" : `--target ${target}`);
    const targets = new Set(missed.map(targetOf));
    // at several targets, each says which it missed
    const each = targets.size > 1 ? (image) => item(image.path, `best quality ${Math.floor(image.score)}/100, short of ${wanted(targetOf(image))}`) : best;
    parts.push([`${count(missed.length, "image")} ${missed.length === 1 ? "isn't" : "aren't"} here: no smaller file reaches ${targets.size > 1 ? "its target" : wanted([...targets][0])}.`, `<ul>${biggest(missed).map(each).join("")}</ul>`]);
  }
  if (errors.length) {
    const which = errors.length === 1 ? "1 image or folder" : `${errors.length} images or folders`;
    parts.push([`${which} couldn't be checked or previewed.`, `<ul>${errors.map(({ path, message }) => item(path, message)).join("")}</ul>`]);
  }
  return parts.map(([summary, body]) => `<details class="unlisted"><summary>${escape(summary)}</summary>\n${body}\n</details>`).join("\n");
}

/**
 * The disclosures of a page of copies in `as` ({ name }), as unlisted() gives them: copies that
 * wouldn't save enough beyond their image's own shrink, at each target, by the thresholds in
 * `settings` (check.js shortfall()); images with a file where their copy would go, the biggest saving
 * first; images left out, each with its reason.
 */
function copyParts({ notWorthIt, leftOut, existing, as, cwd, targetOf, settings }, platform) {
  const parts = [];
  const groups = new Map(); // target -> its images
  for (const image of notWorthIt) groups.set(targetOf(image), [...(groups.get(targetOf(image)) ?? []), image]);
  for (const [target, group] of groups) {
    const { images, why, command, which } = shortfall(group, { ...settings, target }, platform);
    const one = images.length === 1;
    // a shrink that leaves the image as it is gives no smaller file to name
    const sizes = ({ path, original, compressed, base }) => `<li><code>${escape(path)}</code>: ${escape(`${size(compressed)} as ${as.name}, ${size(base)} ${base === original ? "as it is" : "shrunk in place"}`)}</li>`;
    parts.push([
      `${count(images.length, "image")} ${one ? "isn't" : "aren't"} here: as ${as.name} ${one ? "it" : "they"} ${why} shrinking ${one ? "it" : "them"} in place.`,
      `<ul>${images.map(sizes).join("")}</ul>${command ? `\n<p>To shrink ${which} in place instead, run${command.shell}:</p>\n<pre>${escape(command.text)}</pre>` : ""}`,
    ]);
  }
  if (existing.length) {
    const one = existing.length === 1;
    const done = [...existing].sort((a, b) => b.base - b.compressed - (a.base - a.compressed));
    parts.push([
      one ? `1 image already has ${as.article} ${as.name} file next to it, which the command never replaces, so it isn't here.` : `${existing.length} images already have ${as.article} ${as.name} file next to them, which the command never replaces, so they aren't here.`,
      `<ul>${done.map(({ path, output }) => `<li><code>${escape(path)}</code> → <code>${escape(pathFrom(cwd, output))}</code></li>`).join("")}</ul>`,
    ]);
  }
  if (leftOut.length) {
    parts.push([`${count(leftOut.length, "image")} ${leftOut.length === 1 ? "is" : "are"} left out:`, `<ul>${leftOut.map(({ path, reason }) => `<li><code>${escape(path)}</code> (${escape(reason)})</li>`).join("")}</ul>`]);
  }
  return parts;
}

/** Whether the image is one to look at first: a lossy result below REVIEW, as people see it. */
function low({ outcome, score }) {
  return outcome === "hit" && Math.round(score) < REVIEW;
}

/**
 * The command's pieces, for the page's script to join: each path (with its target) quoted as text.js
 * quotes it for `platform`, whether that path needs PowerShell there, and the runner for each case.
 * With each card's suffix(), the page's commands are the terminal's (shrinkCommand(), with `format`
 * the one that writes copies in it) for any choice of images.
 */
function pieces(paths, format, platform) {
  const without = (text, tail) => text.slice(0, text.length - tail.length);
  let powershell = null;
  const args = paths.map(({ path, target }) => {
    const arg = quote(path, platform);
    const one = shrinkCommand([path], target, platform, format);
    if (one.shell) powershell = without(one.text, ` ${arg}${suffix(target, format)}`);
    return { arg, powershell: Boolean(one.shell) };
  });
  return { npx: shrinkCommand([], undefined, platform).text, powershell, args };
}

/** How a command ends for `target` and `format`, as shrinkCommand() ends it. */
function suffix(target, format) {
  return `${target === undefined ? "" : ` --target ${target}`}${format === undefined ? "" : ` --format ${format}`}`;
}

/**
 * The targets of a page's cards in plain words: how many images are at each, in the order they come;
 * with a format (`as`), the automatic one is that of each image's own shrink.
 */
function eachTarget(cards, targetOf, as) {
  const files = new Map(); // target -> how many images
  for (const card of cards) files.set(targetOf(card), (files.get(targetOf(card)) ?? 0) + card.paths.length);
  const automatic = as ? `automatic (the quality of its PNG or JPEG shrink, never below quality ${FLOOR})` : `automatic (never below quality ${FLOOR})`;
  const each = [...files].map(([target, n]) => `${target === undefined ? automatic : `quality ${escape(target)}`} for ${count(n, "image")}`);
  return `each image at the target the lint flagged it at: ${each.join(", ")}`;
}

/** `text` safe in HTML text and in a quoted attribute. */
function escape(text) {
  return String(text).replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

/** The CSP source for an inline block: its SHA-256, so nothing else inline runs. */
function hash(text) {
  return `sha256-${createHash("sha256").update(text).digest("base64")}`;
}

// What follows runs in the page: each function goes in as its source text (with size(), smaller()
// and count() from text.js, so the page's numbers read as the terminal's). The first four are pure,
// for the tests to run them without a browser.

/**
 * The commands that shrink the images ticked in `on` (every copy of each), biggest saving first: one
 * per target, its first image's first, each kept under data.limit characters where one path allows;
 * and " in PowerShell" when one of them needs it, as the terminal's commands say (all then run in
 * PowerShell, so they paste in one go).
 */
function commands(data, on) {
  const chosen = data.images.filter((_, i) => on[i]);
  if (chosen.length === 0) return { lines: [], shell: "" };
  const powershell = chosen.some((image) => image.powershell);
  const runner = powershell ? data.powershell : data.npx;
  const lines = [];
  for (const suffix of new Set(chosen.map((image) => image.suffix))) {
    let line = runner;
    for (const arg of chosen.filter((image) => image.suffix === suffix).flatMap((image) => image.args)) {
      if (line !== runner && line.length + 1 + arg.length + suffix.length > data.limit) {
        lines.push(line + suffix);
        line = runner;
      }
      line += ` ${arg}`;
    }
    lines.push(line + suffix);
  }
  return { lines, shell: powershell ? " in PowerShell" : "" };
}

/**
 * What the ticked images add up to, every copy counted: "could save", as the terminal's "could be",
 * since a bare "smaller" reads as done and nothing has changed yet; with one card, its tick is all
 * there is to count.
 */
function tally(data, on) {
  const chosen = data.images.filter((_, i) => on[i]);
  const all = data.images.reduce((sum, image) => sum + image.count, 0);
  const one = data.images.length === 1;
  if (chosen.length === 0) return one ? "Not ticked." : `None of the ${count(all, "image")} ticked.`;
  const ticked = chosen.reduce((sum, image) => sum + image.count, 0);
  const original = chosen.reduce((sum, image) => sum + image.original, 0);
  const compressed = chosen.reduce((sum, image) => sum + image.compressed, 0);
  const lead = one ? "Ticked" : `${ticked} of ${count(all, "image")} ticked`;
  return unbroken(`${lead}: could save ${size(original - compressed)} (${size(original)} → ${size(compressed)}, ${smaller(original, compressed)}% smaller)`);
}

/**
 * The words before the command, and before the folder it runs in when there's one to run; `one` on a
 * page of one image, whose tally reads "Not ticked."
 */
function instruction(ticked, lines, shell, one = false) {
  if (ticked === 0 && one) return "Tick the image to shrink it, and the command that shrinks it appears here.";
  if (ticked === 0) return "Tick the images to shrink, and the command that shrinks them appears here.";
  const what = lines > 1 ? `these ${lines} commands` : "this";
  return `To shrink ${ticked === 1 ? "it" : "them"} in place (lossy, so commit first), run ${what}${shell}`;
}

/**
 * tally() on a page of copies, under the name start() calls: what the ticked images' copies in
 * data.name ("WebP", "AVIF") add up to, every copy counted.
 */
const copyTally = function tally(data, on) {
  const chosen = data.images.filter((_, i) => on[i]);
  const all = data.images.reduce((sum, image) => sum + image.count, 0);
  const one = data.images.length === 1;
  if (chosen.length === 0) return one ? "Not ticked." : `None of the ${count(all, "image")} ticked.`;
  const ticked = chosen.reduce((sum, image) => sum + image.count, 0);
  const original = chosen.reduce((sum, image) => sum + image.original, 0);
  const compressed = chosen.reduce((sum, image) => sum + image.compressed, 0);
  const lead = one ? "Ticked" : `${ticked} of ${count(all, "image")} ticked`;
  return unbroken(`${lead}: as ${data.name}, could save ${size(original - compressed)} (${size(original)} → ${size(compressed)}, ${smaller(original, compressed)}% smaller)`);
};

/** instruction() on a page of copies, under the name start() calls: its command writes new files, and leaves the images as they are. */
const copyInstruction = function instruction(ticked, lines, shell, one = false) {
  if (ticked === 0 && one) return "Tick the image to write it, and the command that writes it appears here.";
  if (ticked === 0) return "Tick the images to write, and the command that writes them appears here.";
  return `To write ${ticked === 1 ? "it" : "them"}, run ${lines > 1 ? `these ${lines} commands` : "this"}${shell}`;
};

/** `text` with each size's number and unit joined by a no-break space, so no line breaks between them. */
function unbroken(text) {
  return text.replace(/(\d) (?=[kMG]?B\b)/g, "$1\u00A0");
}

/** The page's controls: the ticks, the bar, the views, and each image's comparison. */
function start() {
  const data = JSON.parse(document.getElementById("data").textContent);
  const on = data.images.map(() => true);
  const cards = [...document.querySelectorAll(".image")];
  const ticks = cards.map((card) => card.querySelector(".pick input"));
  const all = document.getElementById("all");
  const low = document.getElementById("low");
  const command = document.getElementById("command");
  const status = document.getElementById("status");
  const bar = document.querySelector(".bar");
  const lows = data.images.flatMap((image, i) => (image.low ? [i] : []));
  let lines = [];
  const update = () => {
    // what Copy said ("The command is selected") was about the commands before this change
    status.textContent = "";
    status.classList.toggle("hidden", true);
    const ticked = data.images.reduce((sum, image, i) => sum + (on[i] ? image.count : 0), 0);
    const picked = on.filter(Boolean).length;
    if (all) {
      all.checked = picked === on.length;
      all.indeterminate = picked > 0 && picked < on.length;
      low.disabled = !lows.some((i) => on[i]);
    }
    const result = commands(data, on);
    lines = result.lines;
    document.getElementById("tally").textContent = tally(data, on);
    document.getElementById("say").textContent = instruction(ticked, lines.length, result.shell, data.images.length === 1);
    command.textContent = lines.join("\n");
    bar.classList.toggle("empty", picked === 0);
    document.getElementById("copy").disabled = picked === 0;
    cards.forEach((card, i) => {
      card.classList.toggle("off", !on[i]);
      ticks[i].checked = on[i];
    });
  };
  ticks.forEach((tick, i) => tick.addEventListener("change", () => {
    on[i] = tick.checked;
    update();
  }));
  all?.addEventListener("change", () => {
    on.fill(all.checked);
    update();
  });
  low?.addEventListener("click", () => {
    for (const i of lows) on[i] = false;
    update();
  });
  document.getElementById("copy").addEventListener("click", () => copy(lines, command));
  // the cards below quality 80, the rest hidden but still ticked; from the start too, should a
  // browser keep a radio checked across a reload all the same
  const filter = () => document.getElementById("main").classList.toggle("only-low", document.querySelector("input[name=show]:checked")?.value === "low");
  for (const radio of document.querySelectorAll("input[name=show]")) radio.addEventListener("change", filter);
  filter();
  // the background behind transparent pixels, kept for the next page where the browser lets it
  const background = (value) => {
    document.body.dataset.bg = value;
    for (const radio of document.querySelectorAll("input[name=bg]")) radio.checked = radio.value === value;
  };
  for (const radio of document.querySelectorAll("input[name=bg]")) {
    radio.addEventListener("change", () => {
      background(radio.value);
      try {
        localStorage.setItem("slimdeer-review-bg", radio.value);
      } catch {
        // a file:// page may have no storage: the choice lasts as long as the page
      }
    });
  }
  try {
    const kept = localStorage.getItem("slimdeer-review-bg");
    if (["white", "black"].includes(kept) && document.querySelector("input[name=bg]")) background(kept);
  } catch {
    // no storage: the checks
  }
  // on a phone the notes would fill the first screen: there they start closed
  const about = document.getElementById("about");
  const narrow = matchMedia("(max-width: 640px)");
  const fold = () => {
    about.open = !narrow.matches;
  };
  fold();
  narrow.addEventListener("change", fold);
  // keyboard focus scrolls above the bar, never under it: the stylesheet pads for it while it's stuck
  new ResizeObserver(() => document.documentElement.style.setProperty("--bar", `${bar.offsetHeight}px`)).observe(bar);
  cards.forEach(viewer);
  update();
}

/**
 * One comparison: the "after" image over the "before" one, cut at the divider, which a pointer drags
 * (anywhere when the image fits, by its grip when zoomed, where a drag pans) and the range input
 * moves from the keyboard. Zoomed, the divider stays where it is on screen as the image pans under it.
 */
function viewer(card) {
  const figure = card.querySelector(".compare");
  const view = figure.querySelector(".view");
  const pan = view.querySelector(".pan");
  const before = view.querySelector(".before");
  const slider = view.querySelector(".slider");
  let split = 0.5;
  const place = () => {
    const width = pan.clientWidth;
    view.style.setProperty("--d", `${split * width}px`);
    view.style.setProperty("--x", `${pan.scrollLeft + split * width}px`);
  };
  const move = (x) => {
    split = Math.min(1, Math.max(0, x));
    const percent = Math.round(split * 100);
    slider.value = String(percent);
    slider.setAttribute("aria-valuetext", `${percent}%`);
    place();
  };
  slider.addEventListener("input", () => move(Number(slider.value) / 100));
  pan.addEventListener("scroll", place, { passive: true });
  new ResizeObserver(place).observe(view);
  // a photo turned by its EXIF data shows turned: its box takes the shape the browser gives it
  before.addEventListener("load", () => {
    const { naturalWidth: w, naturalHeight: h } = before;
    if (w && h && w * Number(before.getAttribute("height")) !== h * Number(before.getAttribute("width"))) {
      figure.style.setProperty("--w", String(w));
      figure.style.setProperty("--h", String(h));
    }
  });
  view.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    const zoomed = figure.classList.contains("zoomed");
    if (zoomed && !event.target.closest(".divider")) {
      // a finger pans the way it scrolls; a mouse drags the image
      if (event.pointerType !== "mouse") return;
      const start = { x: event.clientX, y: event.clientY, left: pan.scrollLeft, top: pan.scrollTop };
      follow(view, event, "panning", (next) => {
        pan.scrollLeft = start.left - (next.clientX - start.x);
        pan.scrollTop = start.top - (next.clientY - start.y);
      });
      return;
    }
    const slide = (next) => {
      const box = pan.getBoundingClientRect();
      move((next.clientX - box.left) / pan.clientWidth);
    };
    if (event.pointerType !== "mouse" && !event.target.closest(".divider")) {
      // a finger that moves sideways slides the divider; one that moves up or down scrolls the page
      const from = { x: event.clientX, y: event.clientY };
      const decide = (next) => {
        const dx = Math.abs(next.clientX - from.x);
        const dy = Math.abs(next.clientY - from.y);
        if (dx < 6 && dy < 6) return;
        view.removeEventListener("pointermove", decide);
        if (dx > dy) {
          slide(next);
          follow(view, next, "sliding", slide);
        }
      };
      view.addEventListener("pointermove", decide);
      view.addEventListener("pointercancel", () => view.removeEventListener("pointermove", decide), { once: true });
      return;
    }
    // the arrow keys move it next; its ring is for the keyboard, where browsers take the hint
    slider.focus({ preventScroll: true, focusVisible: false });
    slide(event);
    follow(view, event, "sliding", slide);
  });
  const level = (zoom, center) => {
    figure.classList.toggle("zoomed", zoom > 0);
    figure.classList.toggle("pixels", zoom >= 2);
    figure.style.setProperty("--z", String(zoom || 1));
    pan.tabIndex = zoom > 0 ? 0 : -1;
    // the middle of the image in view; at first, its start, where a long strip begins
    pan.scrollLeft = center ? (pan.scrollWidth - pan.clientWidth) / 2 : 0;
    pan.scrollTop = center ? (pan.scrollHeight - pan.clientHeight) / 2 : 0;
    place();
  };
  const radios = [...card.querySelectorAll(".zoom input")];
  for (const radio of radios) radio.addEventListener("change", () => level(Number(radio.value), true));
  level(Number(radios.find((radio) => radio.checked).value), false);
}

/** Calls `step` with each move of the pointer that pressed in `event`, until it lets go. */
function follow(element, event, state, step) {
  event.preventDefault();
  element.setPointerCapture(event.pointerId);
  element.classList.add(state);
  const end = () => {
    element.classList.remove(state);
    element.removeEventListener("pointermove", step);
    element.removeEventListener("pointerup", end);
    element.removeEventListener("pointercancel", end);
  };
  element.addEventListener("pointermove", step);
  element.addEventListener("pointerup", end);
  element.addEventListener("pointercancel", end);
}

/**
 * On an AVIF page, each "after" the browser can't show (Safari before 16.4 has no AVIF) gives way to
 * `sentence`; an image that failed before this script ran has no error left to send, so its state is
 * looked at too. The page's policy runs no inline handler: the listener is added here.
 */
function unshown(sentence) {
  for (const image of document.querySelectorAll("img.after")) {
    const say = () => {
      // the after half stays covered, so the original never passes for the copy; the sentence goes
      // under the picture, where it fits at any size and zoom
      const cover = document.createElement("div");
      cover.className = "after unshown";
      const note = document.createElement("p");
      note.className = "unshown-note";
      note.textContent = sentence;
      image.closest(".compare").append(note);
      image.replaceWith(cover);
    };
    if (image.complete && image.naturalWidth === 0) say();
    else image.addEventListener("error", say);
  }
}

/** Copies the commands in `lines`, or failing that, selects them in `shown` for the reader to copy. */
function copy(lines, shown) {
  const text = lines.join("\n");
  // one command or several, as the bar counts them (a quoted path may hold a line break)
  const several = lines.length > 1;
  const button = document.getElementById("copy");
  const status = document.getElementById("status");
  const done = (copied) => {
    if (!copied) getSelection().selectAllChildren(shown);
    button.textContent = copied ? "Copied" : "Copy";
    status.textContent = copied ? `Copied the ${several ? "commands" : "command"}.` : `Couldn't copy. The ${several ? "commands are" : "command is"} selected: press Ctrl+C (⌘C on a Mac).`;
    // the button says it copied; that it didn't, and what to press, everyone needs to read
    status.classList.toggle("hidden", copied);
    setTimeout(() => {
      button.textContent = "Copy";
    }, 2000);
  };
  // file:// pages may get no clipboard: an old way works in more of them
  const fallback = () => {
    const area = document.createElement("textarea");
    area.value = text;
    area.className = "offscreen";
    document.body.append(area);
    area.select();
    let copied = false;
    try {
      copied = document.execCommand("copy");
    } catch {
      copied = false;
    }
    area.remove();
    done(copied);
  };
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(() => done(true), fallback);
  else fallback();
}

const STYLE = `
:root {
  color-scheme: light dark;
  --bg: #f4f4f3; --surface: #ffffff; --line: #e1e1de; --text: #1b1b1a; --muted: #5b5b58;
  --accent: #1a5fd0; --warn: #9a5b00; --tag: #f1efe9; --check-a: #ffffff; --check-b: #e7e7e4;
  --divider: #ffffff; --shade: rgb(0 0 0 / 0.45);
  --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
  font: 15px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", sans-serif;
  color: var(--text);
  background: var(--bg);
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #111111; --surface: #1a1a1a; --line: #2e2e2d; --text: #ecece9; --muted: #a3a39f;
    --accent: #7eaefc; --warn: #e9a94e; --tag: #2a2925; --check-a: #4d4d4d; --check-b: #3e3e3e;
  }
}
*, *::before, *::after { box-sizing: border-box; }
body { margin: 0; }
code, pre, .path { font-family: var(--mono); font-size: 0.9em; }
button, input { font: inherit; color: inherit; }
a { color: var(--accent); }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
.offscreen { position: fixed; top: 0; left: -9999px; }
.skip { position: absolute; z-index: 3; top: 8px; left: 16px; padding: 6px 12px; background: var(--surface); border: 1px solid var(--line); border-radius: 8px; transform: translateY(-200%); }
.skip:focus { transform: none; }
body:has(.bar.empty) .skip { display: none; }
.muted { color: var(--muted); }
.top, main, .bar-in { max-width: 1120px; margin: 0 auto; padding-inline: 24px; }
.top { padding-top: 40px; padding-bottom: 4px; }
@media (min-width: 900px) { .top { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 0.9fr); gap: 40px; align-items: start; } }
.tool { margin: 0 0 6px; color: var(--muted); font-size: 13px; }
h1 { margin: 0; font-size: 30px; line-height: 1.2; font-weight: 650; letter-spacing: -0.01em; }
.sum { margin: 4px 0 18px; font-size: 18px; color: var(--muted); font-variant-numeric: tabular-nums; }
.meta { display: grid; grid-template-columns: max-content 1fr; gap: 2px 16px; margin: 0 0 16px; font-size: 14px; }
.meta div { display: contents; }
.meta dt { color: var(--muted); }
.meta dd { margin: 0; overflow-wrap: anywhere; }
.notes { font-size: 14px; color: var(--muted); padding-bottom: 10px; }
.notes p { margin: 0 0 8px; max-width: 70ch; }
summary { cursor: pointer; width: fit-content; }
.about > summary { margin: 0 0 8px; }
.about:not([open]) > summary { margin: 0; }
@media (min-width: 641px) { .about > summary { display: none; } }
.unlisted { margin: 0 0 8px; max-width: 70ch; }
.unlisted ul { margin: 6px 0 8px; padding-left: 20px; overflow-wrap: anywhere; }
.unlisted li code { color: var(--text); }
.unlisted pre { margin: 0 0 8px; padding: 6px 8px; white-space: pre-wrap; overflow-wrap: anywhere; background: var(--surface); border: 1px solid var(--line); border-radius: 6px; color: var(--text); font-size: 12px; }
main { padding-top: 12px; padding-bottom: 32px; }
.tools { display: flex; align-items: center; justify-content: space-between; gap: 10px 24px; flex-wrap: wrap; margin: 0 0 14px; padding-top: 14px; border-top: 1px solid var(--line); }
.how { margin: 0; font-size: 14px; color: var(--muted); flex: 1 1 100%; }
.views { display: flex; align-items: center; gap: 10px 24px; flex-wrap: wrap; }
.views:empty { display: none; }
.group { display: inline-flex; align-items: center; gap: 8px; border: 0; margin: 0; padding: 0; min-width: 0; }
.group legend { float: left; padding: 0; font-size: 13px; color: var(--muted); }
.bulk { display: flex; align-items: center; gap: 16px; margin-left: auto; }
.all { display: inline-flex; align-items: center; gap: 8px; font-size: 14px; cursor: pointer; }
button { border: 1px solid var(--line); background: var(--surface); border-radius: 8px; padding: 5px 12px; font-size: 14px; cursor: pointer; }
button:hover:not(:disabled) { background: var(--tag); }
button:disabled { cursor: default; color: var(--muted); opacity: 0.6; }
.index { margin: 0 0 18px; font-size: 14px; }
.index > summary { color: var(--muted); }
.index table { width: 100%; margin-top: 8px; border-collapse: collapse; background: var(--surface); border: 1px solid var(--line); border-radius: 8px; font-variant-numeric: tabular-nums; }
.index th { text-align: left; font-weight: 600; font-size: 13px; color: var(--muted); }
.index th, .index td { padding: 5px 10px; border-bottom: 1px solid var(--line); vertical-align: baseline; }
.index tr:last-child td { border-bottom: 0; }
.index td:first-child { font-family: var(--mono); font-size: 13px; overflow-wrap: anywhere; }
.index td:not(:first-child), .index th:not(:first-child) { white-space: nowrap; }
.only-low .image:not(.low-card), .only-low .index tbody tr:not(.low-row) { display: none; }
.image { background: var(--surface); border: 1px solid var(--line); border-radius: 12px; padding: 16px 18px 18px; margin: 0 0 20px; scroll-margin-top: 12px; }
.view { transition: opacity 0.15s; }
.head { display: flex; align-items: baseline; justify-content: space-between; gap: 6px 16px; flex-wrap: wrap; }
.path { margin: 0; font-size: 15px; font-weight: 600; overflow-wrap: anywhere; min-width: 0; }
.pick { display: inline-flex; align-items: center; gap: 8px; font-size: 14px; cursor: pointer; white-space: nowrap; }
.also { margin: 2px 0 0; font-size: 13px; color: var(--muted); overflow-wrap: anywhere; }
input[type="checkbox"] { width: 18px; height: 18px; margin: 0; accent-color: var(--accent); cursor: pointer; }
.facts { display: flex; align-items: center; justify-content: space-between; gap: 8px 16px; flex-wrap: wrap; margin: 2px 0 12px; }
.facts p { margin: 0; color: var(--muted); font-size: 14px; font-variant-numeric: tabular-nums; }
.dot { padding: 0 4px; }
.low { color: var(--warn); }
.low::before { content: ""; display: inline-block; width: 7px; height: 7px; margin-right: 6px; border-radius: 50%; background: currentColor; vertical-align: 1px; }
.choice { display: inline-flex; border: 1px solid var(--line); border-radius: 8px; padding: 2px; margin: 0; gap: 2px; }
.choice label { position: relative; }
.choice input { position: absolute; inset: 0; opacity: 0; margin: 0; cursor: pointer; }
.choice span { display: block; padding: 2px 10px; border-radius: 6px; font-size: 13px; color: var(--muted); font-variant-numeric: tabular-nums; white-space: nowrap; }
.choice input:checked + span { background: var(--tag); color: var(--text); font-weight: 600; }
.choice input:focus-visible + span { outline: 2px solid var(--accent); outline-offset: 1px; }
.image.off .view { opacity: 0.4; }
.compare { margin: 0 auto; width: min(100%, calc(var(--w) * 1px), calc(70vh * var(--w) / var(--h))); }
.compare.zoomed { width: min(100%, calc(var(--w) * var(--z) * 1px)); }
.labels { display: flex; justify-content: space-between; flex-wrap: wrap; gap: 0 12px; margin: 0 0 6px; font-size: 13px; color: var(--muted); }
.labels > span { white-space: nowrap; }
.labels b { color: var(--text); font-weight: 600; font-variant-numeric: tabular-nums; }
.view { position: relative; aspect-ratio: var(--w) / var(--h); border-radius: 6px; overflow: hidden; touch-action: pan-y; cursor: ew-resize; user-select: none; -webkit-user-select: none; outline: 1px solid var(--line); }
.zoomed .view { aspect-ratio: auto; height: min(70vh, calc(var(--h) * var(--z) * 1px)); touch-action: auto; cursor: grab; }
.zoomed .view.panning { cursor: grabbing; }
.pan { position: absolute; inset: 0; overflow: hidden; }
.zoomed .pan { overflow: auto; }
.pan:focus-visible { outline-offset: -3px; }
.canvas { position: absolute; inset: 0; background: repeating-conic-gradient(var(--check-a) 0 25%, var(--check-b) 0 50%) 0 0 / 16px 16px; }
[data-bg="white"] .canvas { background: #ffffff; }
[data-bg="black"] .canvas { background: #000000; }
.zoomed .canvas { position: relative; inset: auto; width: calc(var(--w) * var(--z) * 1px); height: calc(var(--h) * var(--z) * 1px); }
.canvas img { position: absolute; inset: 0; display: block; width: 100%; height: 100%; -webkit-user-drag: none; }
.pixels .canvas img { image-rendering: pixelated; }
@media (min-resolution: 2dppx) { .zoomed .canvas img { image-rendering: pixelated; } }
.after { clip-path: inset(0 0 0 var(--x, 50%)); }
/* the grip (and the keyboard's slider under it) near the top of a tall image, so a laptop's first screen shows it above the bar */
.slider { position: absolute; left: var(--d, 50%); top: min(50%, 160px); width: 44px; height: 44px; margin: -22px 0 0 -22px; opacity: 0; pointer-events: none; }
.divider { position: absolute; top: 0; bottom: 0; left: var(--d, 50%); width: 0; cursor: ew-resize; touch-action: none; }
.divider::before { content: ""; position: absolute; top: 0; bottom: 0; left: -1px; width: 2px; background: var(--divider); box-shadow: 0 0 0 1px var(--shade); }
.divider::after { content: ""; position: absolute; top: 0; bottom: 0; left: -14px; width: 28px; }
.grip { position: absolute; top: min(50%, 160px); left: 0; width: 34px; height: 34px; margin: -17px 0 0 -17px; border-radius: 50%; background: var(--divider); box-shadow: 0 0 0 1px var(--shade), 0 2px 6px rgb(0 0 0 / 0.25); z-index: 1; }
.grip::before, .grip::after { content: ""; position: absolute; top: 50%; width: 0; height: 0; margin-top: -5px; border: 5px solid transparent; }
.grip::before { left: 5px; border-right: 6px solid #3a3a38; }
.grip::after { right: 5px; border-left: 6px solid #3a3a38; }
.slider:focus-visible + .divider .grip { outline: 3px solid var(--accent); outline-offset: 2px; }
:root { scroll-padding-bottom: calc(var(--bar, 0px) + 12px); }
.bar { position: sticky; bottom: 0; z-index: 2; background: var(--surface); border-top: 1px solid var(--line); box-shadow: 0 -6px 18px rgb(0 0 0 / 0.06); }
.bar-in { padding-top: 12px; padding-bottom: 14px; }
#tally { margin: 0; font-size: 15px; font-weight: 600; font-variant-numeric: tabular-nums; }
.say { margin: 4px 0 8px; font-size: 13px; color: var(--muted); overflow-wrap: anywhere; }
.say code { color: var(--text); }
.cmd { display: flex; gap: 8px; align-items: stretch; }
#command { flex: 1; min-width: 0; margin: 0; padding: 8px 10px; max-height: 4.9em; overflow: auto; white-space: pre; background: var(--bg); border: 1px solid var(--line); border-radius: 8px; font-size: 13px; line-height: 1.45; }
#copy { flex: none; min-width: 5.5em; font-weight: 600; }
#status { margin: 6px 0 0; font-size: 13px; color: var(--warn); }
.bar.empty .cmd, .bar.empty .where, .bar.empty .colon { display: none; }
@media (max-width: 640px) {
  .top, main, .bar-in { padding-inline: 16px; }
  .top { padding-top: 24px; }
  h1 { font-size: 24px; }
  .sum { font-size: 16px; margin-bottom: 12px; }
  .meta, .notes { font-size: 13px; }
  .how, .index .size, .where { display: none; }
  .bulk { margin-left: 0; }
  .image { padding: 12px 12px 14px; border-radius: 10px; }
  .compare { width: min(100%, calc(var(--w) * 1px), calc(60vh * var(--w) / var(--h))); }
  .zoomed .view { height: min(60vh, calc(var(--h) * var(--z) * 1px)); }
  .bar-in { padding-top: 8px; padding-bottom: 10px; }
  #tally { font-size: 14px; }
  .say { font-size: 12px; margin-bottom: 6px; }
  #command { max-height: 3.4em; padding: 6px 8px; font-size: 12px; }
}
/* a short window (a phone on its side, a page zoomed in far): stuck, the bar would cover the images */
@media (max-height: 480px) {
  :root { scroll-padding-bottom: 0; }
  .bar { position: static; }
}
@media (prefers-reduced-motion: reduce) { .view { transition: none; } }
/* on paper the bar follows the last card instead of covering one, a card keeps to a page, and the
   divider has no grip to drag; the script places it in pixels of the screen's frame, so a fitted
   image's goes back to the middle (a zoomed one's cut is in pixels of the whole image: it stays).
   Paper has no scroll bar: the command wraps to print whole, without Copy or what Copy said */
@media print {
  .bar { position: static; box-shadow: none; }
  .image { break-inside: avoid; }
  .compare:not(.zoomed) .view { --d: 50% !important; --x: 50% !important; }
  .grip { display: none; }
  #command { max-height: none; white-space: pre-wrap; overflow-wrap: anywhere; }
  #copy, #status { display: none; }
}
`;

// A page of copies adds what to keep in mind before converting, what its command does, and, where an
// "after" can't be shown, a blank right of the divider, where the "after" would be, and the reason under it.
const COPY_STYLE = `.cautions { margin: 0 0 16px; padding-left: 20px; font-size: 14px; max-width: 70ch; }
.cautions li { margin: 0 0 4px; }
.writes { margin: 6px 0 0; font-size: 13px; color: var(--muted); }
.bar.empty .writes { display: none; }
.unshown { position: absolute; inset: 0; background: var(--surface); }
.unshown-note { margin: 6px 0 0; color: var(--warn); font-size: 13px; }
`;
