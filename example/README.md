# Example app

A tiny app with 6 images, to see the rule work. From the repository's root:

```bash
npm ci
cd example
npx oxlint
```

With ESLint, run `npx eslint .` instead; eslint.config.js holds the same setup.

You get 4 warnings, one per image, and a table of what they add up to. The rest stay quiet: `heart.png` is already small, and `/missing.png` doesn't exist. No code names `unused-fire.png`, so it gets no warning; the run lists it below the table, as mentioned in a Markdown file. The first run takes a few seconds, and later runs are instant.

From a clone, run the command with node. `node ../bin/slimdeer.js --review --flagged` writes a page that shows the 4 images before and after, and prints its address. `node ../bin/slimdeer.js --flagged` shrinks them, writing over the images; `git checkout .` brings them back. `node ../bin/slimdeer.js --check --format webp` compares each image's WebP copy with its shrink at the same quality score, and changes none of them.

[SOURCES.md](SOURCES.md) lists where the images come from and their licenses.
