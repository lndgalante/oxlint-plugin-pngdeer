# Public project asset trials

The `--check` command was run against 36 images from three pinned public repositories on November 1, 2026. These bounded samples exercise a starter site's assets, documentation diagrams and screenshots, and small portraits. Each sample contains every PNG/JPEG under its selected path; selection happened before compression results were known.

All 36 input hashes stayed unchanged, cold and cached checks agreed, and no engine errors occurred. Savings varied substantially by sample, supporting an evaluation step before enabling the rule in a project.

## Sources and scope

| Project | Selected path | Images | Source revision |
|---|---|---:|---|
| Docusaurus | `examples/classic/` | 5 | [6531677](https://github.com/facebook/docusaurus/tree/653167747c8776546c0dd2c25620df1b7f6d7a59/examples/classic) |
| Starlight | `docs/src/assets/testimonials/` | 12 | [6c9ca43](https://github.com/withastro/starlight/tree/6c9ca431629bbd37d969876f5f4281b5f5a34d38/docs/src/assets/testimonials) |
| Vue documentation | `src/guide/` | 19 | [40aa88a](https://github.com/vuejs/docs/tree/40aa88af0094f7bab4aaf786e55c748a6a251d88/src/guide) |

[trial-images.json](trial-images.json) pins every path, byte count and Git blob hash. The harness downloads only those images, copies them into temporary projects, and checks the copies. It does not install or execute the upstream projects. The images retain their upstream terms and are not included in this repository or npm package.

## Results

Development version 0.4.0, engine hash prefix `ad2351d25459d45c`, Node 26.12.0, Apple M3 Max with 16 cores, Darwin 25.6.0. The command used automatic quality and the default thresholds of 4,096 bytes and 10%. Savings below either threshold are excluded from the savings column.

| Sample | Input bytes | Flagged | Estimated savings | Share of input bytes | Cold | Cached |
|---|---:|---:|---:|---:|---:|---:|
| Docusaurus starter | 210,278 | 4 / 5 | 110,772 B | 52.7% | 1.44 s | 64 ms |
| Starlight portraits | 208,935 | 2 / 12 | 14,310 B | 6.8% | 0.74 s | 62 ms |
| Vue guide images | 1,213,949 | 19 / 19 | 898,356 B | 74.0% | 7.11 s | 67 ms |

Each cold result is one run with an empty cache; cached time is the median of three later checks. Timings include CLI startup, scanning and measurement, and exclude downloading. The samples ran sequentially without other plugin compression tests. [trials-results.json](trials-results.json) retains per-image sizes, scores, outcomes and SHA-256 hashes.

The four reported Docusaurus images scored 73.1–90.7 on SSIMULACRA2, the two Starlight portraits scored about 78.2, and the Vue candidates scored 89.0–92.6. Those are perceptual estimates from lossy compression. The lower JPEG scores particularly warrant a visual comparison or a higher explicit target before replacing an original.

These figures describe repository assets. They do not measure deployed transfer sizes: an image pipeline or CDN may already re-encode those assets. The trials also do not measure warning placement in each project's linter configuration, visual acceptability, or whether maintainers retain the rule. Those require a maintainer pilot with visual review and observation over time.

## Reproduce

```bash
node bench/trials.js --fetch-only
node bench/trials.js --json /tmp/pngdeer-trials.json
```

The first command fetches the pinned images into ignored `bench/.images/trials/` and verifies their Git blob hashes. The second runs offline against fresh temporary copies and removes those copies and their caches afterward. It verifies image hashes again after both cold and cached checks, and fails if their exit codes disagree. No `--flagged` or in-place compression command is used.
