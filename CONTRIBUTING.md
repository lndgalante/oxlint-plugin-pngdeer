# Contributing

You need Node 20.19+ or 22.13+, and npm (the package checks run npm itself):

```bash
git clone https://github.com/lndgalante/oxlint-plugin-slimdeer
cd oxlint-plugin-slimdeer
npm ci
```

| Command | What it does | Time |
|---|---|---|
| `npm test` | every test | about 100 s |
| `node --test test/tsconfig.test.js` | one test file | under a second; files that lint a project take longer, like `test/rule.test.js` at about 100 s |
| `node --test test/review.test.js` | `--review` and its page | about 30 s |
| `node --test test/lsp.test.js` | oxlint's language server, started as the Oxc extensions start it | about a second |
| `npm run lint` | oxlint on the repo's own code, failing on any warning | under a second |
| `npm run check:package` | packs the package and runs it in a fresh app with oxlint and ESLint | a few seconds |
| `node scripts/check-engine.js` | checks the engine files against `engine/provenance.json` | instant |
| `npm run bench` | the benchmark in `bench/README.md` | about a minute, after a 20 MB image download on the first run; peaks at about 3 GB of memory |

Those times are from a 16-core M3 Max. The tests compress real images with up to eight workers. CI takes 1 to 5 minutes per job.

CI runs the tests on Linux, macOS and Windows with Node 20, 22, 24 and 26, and on Linux with Node 20.19.0, the oldest supported. It tests oxlint 1.60 (the oldest supported), 1.89 (which Vite+ 1.4 brings), 1.90 and the newest, and ESLint 9.0 and 10. It also runs weekly, for new oxlint releases.

To run your clone's command, use node: `node bin/slimdeer.js --check example` from the root, or `node ../bin/slimdeer.js` inside `example/`. There, `npx oxlint-plugin-slimdeer` runs the published version instead, because `example/` has its own package.json. To look at the review page while you work on it, run `node bin/slimdeer.js --review example --open` from the root: it writes the page to the root's `node_modules/.cache/slimdeer/review/index.html` and opens it. Without `--open`, it prints the page's address.

When behavior or options change, update README.md, docs/rules/compressible-image.md, skills/oxlint-plugin-slimdeer/SKILL.md, src/index.d.ts and the `--help` text in bin/slimdeer.js.

## The engine

Don't edit `engine/` by hand. It is [slimdeer](https://github.com/heydeer/slimdeer)'s WebAssembly build, rebuilt from pinned source: see [engine/README.md](engine/README.md#build-and-compare). A new engine measures every image again, so say so in the release notes.

## Releasing

1. Set the version in package.json and package-lock.json (`npm version <version> --no-git-tag-version` does both). Write `docs/releases/<version>.md`, and add the version to CHANGELOG.md with the release date in place of "(unreleased)".
2. Push to main and wait for CI to pass on that commit.
3. Push the tag `v<version>`. The release workflow checks that CI passed on that commit, that the tag matches package.json, that the notes file exists and that CHANGELOG.md dates the version (prereleases aside). It then publishes to npm with provenance, checks the package npm serves, and creates the GitHub Release from the notes file. A prerelease like `v1.2.3-rc.1` goes out under npm's `next` tag.

If a tag published but a later step failed, run the Release workflow by hand (Actions > Release > Run workflow) with that tag. It runs the checks, verifies the published package and creates the GitHub Release, and never publishes.
