# oxlint-plugin-pngdeer (prototype)

An oxlint rule that says, on the line of code that names an image, how much smaller pngdeer would make it at the same visual quality:

```
src/App.jsx:10:16: warning pngdeer(compressible-image): hero.png could be 359 kB smaller (70%: 509 kB → 151 kB) and still look right. Run: pngdeer public/hero.png -o public/hero.png
```

Whether this is a good idea, what it costs and what it can't do: [FINDINGS.md](FINDINGS.md).

## Try it

```bash
npm install
cd example
../node_modules/.bin/oxlint    # about 5 s the first time, 0.1 s after
```

The engine in `engine/` is pngdeer's single-threaded WebAssembly build as served by heydeer.ai, not built from source here ([engine/README.md](engine/README.md) has its commit and hashes). The example's images come from pngdeer's `bench/images` ([example/SOURCES.md](example/SOURCES.md)).

## Use it in a project

```json
{
  "jsPlugins": ["oxlint-plugin-pngdeer"],
  "settings": { "pngdeer": { "publicDirs": ["public"] } },
  "rules": { "pngdeer/compressible-image": ["warn", { "minBytes": 4096, "minPercent": 10 }] }
}
```

Results are cached in `node_modules/.cache/pngdeer`, one small JSON file per image content.

## License

[MIT](LICENSE). The engine's dependencies keep their own licenses ([engine/THIRD_PARTY_LICENSES.txt](engine/THIRD_PARTY_LICENSES.txt)), as do the example images. JPEG output is encoded with mozjpeg: this software is based in part on the work of the Independent JPEG Group.
