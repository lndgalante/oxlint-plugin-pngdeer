# Benchmark

How long the rule takes in a realistic app, from the first lint, which measures every image, to the cached lints after it.

```bash
npm run bench                      # medium: 200 components, 39 images
npm run bench -- --size small      # 20 components, 16 images
npm run bench -- --size large      # 1,000 components, 41 images, two of them 16–24 MP camera originals
npm run bench -- --json out.json   # the results as JSON too
```

The first run downloads the images (20 MB) into `bench/.images`, once. Each run builds the app in your temporary folder, outside this repo, whose `.gitignore` oxlint would follow. The app has:

- components that name images every way the rule reads: imports, a tsconfig `@/` alias, `new URL(…, import.meta.url)`, JSX `src` and `srcSet`, and paths in data;
- a logo named in every tenth file;
- images that only CSS names, and unused images, which only the first run's project scan finds;
- tiny icons below the rule's threshold;
- plain components with no images.

Each row is one command run in the app:

| Row | What it runs |
|---|---|
| oxlint, without the plugin | the same lint without pngdeer: the baseline |
| first run | a fresh clone: no cache, so every image is measured |
| later runs | everything cached (median of 3) |
| after one image changed | one image's bytes replaced, so only that image is measured again |
| ESLint | ESLint 10 on the `.jsx` files, cached |
| ESLint's language server | an editor's first lint with no cache: it must return at once, then the warnings arrive as the background measuring fills the cache |
| `--flagged` | shrinking everything the last lint flagged, on a copy of the app |

Peak memory is the whole process's, read from `/usr/bin/time` on macOS and Linux. It includes the plugin's worker threads, which compress images within a quarter of the machine's memory (1–4 GB).

## Results

`medium`, oxlint-plugin-pngdeer 0.3.0, on an Apple M3 Max (16 cores, 52 GB), macOS 26, Node 26, oxlint 1.90.0 and ESLint 10.14.0:

| What | Time | Peak memory | |
|---|---:|---:|---|
| oxlint, without the plugin | 68 ms | 86 MB |  |
| oxlint + pngdeer, first run | 14.6 s | 3.0 GB | measured 35 images, 78 warnings |
| oxlint + pngdeer, later runs (median of 3) | 178 ms | 116 MB | 78 warnings |
| oxlint + pngdeer, after one image changed | 960 ms | 169 MB | measured 1 image, 78 warnings |
| ESLint + pngdeer, later run (.jsx files) | 264 ms | 195 MB | 66 warnings |
| ESLint's language server, first lint, nothing cached | 171 ms | 3.1 GB | 0 warnings at once, all 66 after 15.3 s (measured in the background) |
| npx oxlint-plugin-pngdeer --flagged | 11.5 s | 3.0 GB | shrank 30 images |

`large` on the same machine has 1,000 components and the same images, plus the two camera originals. Its first run takes 79.8 s at 3.9 GB: the camera originals add about 65 s on their own. Later runs take 256 ms, against 87 ms for oxlint alone, and an editor's first lint returns in 465 ms.

## Images

[images.json](images.json) lists each file's URL, SHA-256, size and license. If a download's bytes no longer match the manifest (Wikimedia renders its thumbnails again now and then), the benchmark says so and carries on, but its times then won't compare with earlier runs.

| Files | Source | License |
|---|---|---|
| `kodak-*.png`: 8 photos saved as PNG | [Kodak Lossless True Color Image Suite](https://r0k.us/graphics/kodak/), Eastman Kodak Company, hosted by Rich Franzen | Released by Kodak for unrestricted use |
| `fluent-*.png`: 16 3D icons | [Microsoft Fluent Emoji](https://github.com/microsoft/fluentui-emoji), © Microsoft Corporation | MIT |
| `*-diagram*-1280.png`, `entamoeba-histolytica-life-cycle-en-1280.png`: 6 diagrams rendered at 1280 px | Mariana Ruiz Villarreal (LadyofHats) on Wikimedia Commons: [mature flower](https://commons.wikimedia.org/wiki/File:Mature_flower_diagram.svg), [digestive system](https://commons.wikimedia.org/wiki/File:Digestive_system_diagram_en.svg) (with edits by Jmarchn), [Culex pipiens](https://commons.wikimedia.org/wiki/File:Culex_pipiens_diagram_en.svg), [endomembrane system](https://commons.wikimedia.org/wiki/File:Endomembrane_system_diagram_en.svg), [Entamoeba histolytica](https://commons.wikimedia.org/wiki/File:Entamoeba_histolytica_life_cycle-en.svg), [flagellum base](https://commons.wikimedia.org/wiki/File:Flagellum_base_diagram-en.svg) | Public domain |
| `citrus-fruits.jpg` | [Scott Bauer, USDA Agricultural Research Service](https://commons.wikimedia.org/wiki/File:Citrus_fruits.jpg) | Public domain |
| `lenticular-clouds.jpg` | [NOAA Earth System Research Laboratory](https://commons.wikimedia.org/wiki/File:Lenticular_clouds_in_Boulder_CO_-_NOAA_Earth_System_Research_Laboratory.jpg) | Public domain |
| `melvin-dogs-portrait.jpg` | [Robert Markowitz, NASA](https://commons.wikimedia.org/wiki/File:NASA_astronaut_Leland_D._Melvin_with_his_dogs_Jake_and_Scout.jpg) | Public domain |
| `loc-great-hall.jpg` | [Carol M. Highsmith, Library of Congress](https://commons.wikimedia.org/wiki/File:Great_Hall,_view_of_second_floor_with_Minerva_in_distance._Library_of_Congress_Thomas_Jefferson_Building,_Washington,_D.C._LCCN2007687181.jpg) | Public domain |
| `houston-skyline.jpg` | [Carol M. Highsmith, Library of Congress](https://commons.wikimedia.org/wiki/File:Aerial_views_of_the_Houston,_Texas,_skyline_in_2014_LCCN2014632225.jpg) | Public domain |
| `saam-teapot.jpg` | [Smithsonian American Art Museum](https://commons.wikimedia.org/wiki/File:Teapot-saam_1946.6.1.jpg) | CC0 1.0 |
| `grand-teton-winter.jpg` | [A. Falgoust, National Park Service](https://commons.wikimedia.org/wiki/File:Grand_Teton_and_Mount_Owen_in_Winter_(52098524701).jpg) | Public domain |
| `bumble-bee-salvia.jpg` | [Mara Koenig, U.S. Fish and Wildlife Service](https://commons.wikimedia.org/wiki/File:Bumble_bee_in_a_salvia_bloom_(48821113636).jpg) | Public domain |
