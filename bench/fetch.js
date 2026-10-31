// Downloads the benchmark's images (bench/images.json) into bench/.images, once, checking each one's
// SHA-256 so runs on different machines measure the same bytes. The images aren't committed: the
// manifest says where each comes from and under which license.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
export const IMAGES = join(here, ".images");
// Wikimedia asks for a User-Agent that says who's asking
const HEADERS = { "user-agent": "oxlint-plugin-pngdeer-bench (https://github.com/lndgalante/oxlint-plugin-pngdeer)" };

/** The manifest's images, each downloaded if it isn't yet: [{ ...entry, path }]. */
export async function fetchImages() {
  const manifest = JSON.parse(readFileSync(join(here, "images.json"), "utf8"));
  mkdirSync(IMAGES, { recursive: true });
  const missing = manifest.filter((image) => !existsSync(join(IMAGES, image.name)));
  if (missing.length) process.stderr.write(`bench: downloading ${missing.length} of ${manifest.length} images...\n`);
  // a few at a time: some hosts limit how many requests one client makes
  for (let i = 0; i < missing.length; i += 4) {
    await Promise.all(missing.slice(i, i + 4).map(download));
  }
  return manifest.map((image) => ({ ...image, path: join(IMAGES, image.name) }));
}

async function download(image) {
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetch(image.url, { headers: HEADERS, redirect: "follow" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      // Wikimedia renders its thumbnails again now and then: the image is the same, its bytes aren't
      if (sha256 !== image.sha256) process.stderr.write(`bench: ${image.name} isn't the manifest's bytes any more (SHA-256 ${sha256}); times won't compare with earlier runs'\n`);
      const path = join(IMAGES, image.name);
      writeFileSync(`${path}.part`, bytes);
      renameSync(`${path}.part`, path);
      return;
    } catch (error) {
      if (attempt === 3) throw new Error(`bench: couldn't get ${image.name} from ${image.url}: ${error.message}`);
      await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
    }
  }
}

// `node bench/fetch.js`: just download them
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const images = await fetchImages();
  process.stderr.write(`bench: ${images.length} images in ${IMAGES}\n`);
}
