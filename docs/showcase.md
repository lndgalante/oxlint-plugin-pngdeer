# Showcase

Using pngdeer in a real project? We'd like to feature a few cases in the README: what it caught, how much smaller the images became, and whether the result looked good enough to ship. [Share yours in an issue](https://github.com/lndgalante/oxlint-plugin-pngdeer/issues/new?template=showcase.yml).

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
