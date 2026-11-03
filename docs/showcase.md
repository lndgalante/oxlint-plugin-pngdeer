# Showcase

These projects ran pngdeer on their own images. Using pngdeer in a real project? We'd like to feature more cases in the README: what it caught, how much smaller the images became, and whether the result looked good enough to ship. [Share yours in an issue](https://github.com/lndgalante/oxlint-plugin-pngdeer/issues/new?template=showcase.yml); [the prompt below](#a-prompt-to-share) helps a coding assistant draft one.

## Multabot

[Multabot](https://multabot.com.ar) tracks traffic fines in Argentina. Its marketing site is built with Astro and deployed on Cloudflare Pages, and its repository is private. Multabot picked these three images, all served from `public/`:

| Image | Where it appears | Original | Compressed | Saved |
|---|---|---:|---:|---:|
| `public/opengraph.png`, 1200×630 PNG | The social preview of every page without its own | 370,801 bytes | 66,520 bytes | 82% |
| `public/images/tres-de-febrero-resultado-infracciones-watermarked.png`, 1280×720 PNG | An annotated screenshot of a municipal fine-lookup portal, on [a guide page](https://multabot.com.ar/multas-tres-de-febrero) | 485,329 bytes | 190,091 bytes | 61% |
| `public/images/blog/multabot-flotas.jpg`, 1024×576 JPEG | The featured image of [a blog post](https://multabot.com.ar/blog/multabot-para-flotas) | 108,899 bytes | 60,161 bytes | 45% |
| **Total** | | **965,029 bytes** | **316,772 bytes** | **67%** |

The originals come from the commit before the project compressed its images. pngdeer 0.5.0 measured them at quality 90 and wrote each compressed file:

```bash
npx oxlint-plugin-pngdeer@0.5.0 --check --target 90 \
  originals/opengraph.png \
  originals/tres-de-febrero-resultado-infracciones-watermarked.png \
  originals/multabot-flotas.jpg
# exit 1 (savings found): 3 checked, 3 measured, 0 skipped, 0 errors

npx oxlint-plugin-pngdeer@0.5.0 originals/opengraph.png --target 90 -o previews/opengraph.preview.png
# and the same for the other two
```

Multabot shipped compressed files made with 0.4.0 at quality 90, and 0.5.0 makes the same bytes. The site doesn't use `astro:assets` or `<Image>`, and Cloudflare doesn't re-encode the files: on November 2, 2026, each URL returned the compressed PNG or JPEG byte for byte (same size and SHA-1), with no `content-encoding` or `cf-polished` header, even to a request that accepted AVIF and WebP. The originals weren't measured on the live site before the change, so the before-and-after transfer is not a measured result.

So far, Multabot has used the command line, not the lint rule.

Compare the originals and compressed files at full size in [docs/images/showcase/multabot](images/showcase/multabot), where `.optimized` marks each compressed one.

## A prompt to share

Send this to a maintainer, or paste it into your coding assistant from your project's folder. Review the report and previews before sharing them in an issue.

```text
Help me prepare a showcase case for oxlint-plugin-pngdeer in this project.

Inspect the project and choose up to three PNG/JPEG assets used by the app.
Run `npx oxlint-plugin-pngdeer --version`, then run
`npx oxlint-plugin-pngdeer@<that version> --check` with explicit paths to
those assets.
Keep original images, source files and linter configuration unchanged.
For images with useful savings, create separate previews in a temporary
directory using the same package version and quality target with `-o`.

Draft a short Markdown report with:
- Project name/link and where each image appears.
- Exact commands, package version and quality target.
- A table of original bytes, preview bytes, bytes saved and percent saved.
- Original and preview paths for me to compare at full size.
- Any errors or images with no useful savings.
- Whether an image optimizer or CDN already re-encodes these assets.
  Describe file-size savings as repository savings; claim browser-transfer
  savings only if you measured the deployed files too.

Use recorded results only. Leave visual approval, any visible tradeoffs and
whether I use or plan to keep the lint rule enabled for me to answer.
Ask how I want to be credited and which material may be featured publicly.
Return the report for my review without posting it or sending messages.
```
