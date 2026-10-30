# Example app

A tiny app with 6 images, to see the rule work. From the repository's root:

```bash
npm ci
cd example
npx oxlint
```

You get 4 warnings, one per image, and a table of what they add up to. The rest stay quiet: `heart.png` is already small, nothing names `unused-fire.png`, and `/missing.png` doesn't exist. The first run takes a few seconds, and later runs are instant.

To shrink them from a clone, run the command with node: `node ../bin/pngdeer.js --flagged`. That writes over the images; `git checkout .` brings them back.

[SOURCES.md](SOURCES.md) lists where the images come from and their licenses.
