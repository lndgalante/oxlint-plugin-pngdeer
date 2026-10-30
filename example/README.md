# Example app

A tiny app with 6 images, to see the rule work. From the repository's root:

```bash
npm ci
cd example
npx oxlint
```

You get 5 warnings for 4 images (`diagram.png` is named twice). The rest stay quiet: `heart.png` is already small, nothing names `unused-fire.png`, and `/missing.png` doesn't exist. The first run takes a few seconds, and later runs are instant.

To shrink an image from a clone, run the command with node: `node ../bin/pngdeer.js public/hero.png`. That writes over the image; `git checkout public/hero.png` brings it back.

[SOURCES.md](SOURCES.md) lists where the images come from and their licenses.
