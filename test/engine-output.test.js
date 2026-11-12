// The engine writes the same files as 0.5.0's did: these hashes were recorded from that build.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { ENGINE } from "../src/cache.js";
import { compress } from "../src/engine.js";

const MOVED = "the engine now writes other files than 0.5.0's: set ENGINE in src/cache.js to the new wasm's first 16 hex digits (every cache is then measured again), and record these hashes again";

// image, target (undefined is automatic), sha256 of the output, outcome, score
const rows = [
  ["public/photo.jpg", undefined, "e3bb624ba8c1e18d38573a7e57d41ee74ce2bd856364878db05147b122bd6816", "hit", 75.541],
  ["public/photo.jpg", 80, "fc2e0e1eb76e815344c4d8ee0f3463c86c3031b324acb44648cc5258c8714494", "hit", 80.211],
  ["public/unused-fire.png", undefined, "1761e518c7690c0ef80715f4ccbeddb7e35252f933c02d7624a0eb75496c9107", "hit", 90.256],
  ["public/unused-fire.png", 80, "e34b313e4662d8096c66a84e1c95c217df20eca6a510ec601ac4ff1631bfcc7e", "hit", 85.467],
  ["src/assets/crystal-ball.png", undefined, "2f345221360373702cfb5957d16fcb688a41091929408aa6ebdaecbe46efc3f0", "hit", 86.895],
  ["src/assets/crystal-ball.png", 80, "cd9e0ddb3220dac8fb340fc1ef534c3199165c1af5e24c4aa2f6d5e5a131cc1d", "hit", 80.08],
  ["src/assets/diagram.png", undefined, "ea168b1d202d3800e8b95d4b613aff7b7cb7c0e7e7793fd94d440cc8328f27c5", "hit", 89.545],
  ["src/assets/diagram.png", 80, "2f3760d7b643811c7ca6360defba1f88f7820a5380ade03ce7c209a99b9f6056", "hit", 82.375],
  ["src/assets/heart.png", undefined, "68da7c6dc7d9c0456174f2575abe8f8abd52cde7a4017700579519173a8a4a34", "original", 91.797],
  ["src/assets/heart.png", 80, "d9d0a0754e49f3c585b1ca5ba90d2f3309877fc92a7fc5d4ba83dc908811a67f", "hit", 81.863],
];

test("the engine is the one 0.5.0 shipped", () => {
  assert.equal(ENGINE, "ad2351d25459d45c", MOVED);
});

for (const [image, target, sha, outcome, score] of rows) {
  test(`${image} at ${target ?? "auto"} comes out as before`, () => {
    const result = compress(readFileSync(new URL(`../example/${image}`, import.meta.url)), target);
    assert.equal(createHash("sha256").update(result.output).digest("hex"), sha, MOVED);
    assert.equal(result.outcome, outcome, MOVED);
    assert.equal(result.score.toFixed(3), score.toFixed(3), MOVED);
  });
}
