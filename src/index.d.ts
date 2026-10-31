/** Options of the `pngdeer/compressible-image` rule (docs/rules/compressible-image.md). */
export interface CompressibleImageOptions {
  /** Report only savings of at least this many bytes. Default 4096. */
  minSavedBytes?: number;
  /** ...and of at least this percent of the file. Default 10. */
  minSavedPercent?: number;
  /** The SSIMULACRA2 score to keep, 0-100, or "auto" (about TinyPNG's quality). Default "auto". */
  target?: "auto" | number;
  /** When to measure images not in the cache. Default "auto". */
  measure?: "auto" | "always" | "never";
}

/** `settings.pngdeer`, shared by every file. */
export interface PngdeerSettings {
  /** Folders where "/x.png" paths are looked up. Default ["public", "static"]. */
  publicDirs?: string[];
  /** Path prefixes and the folders they stand for. Default: the project's tsconfig/jsconfig paths, else { "@/": "src/", "~/": "src/" }. */
  aliases?: Record<string, string>;
  /** Where results are kept, relative to the project root: a folder you can commit. Default node_modules/.cache/pngdeer. */
  cacheDir?: string;
}

// Shaped like an ESLint plugin, so `plugins: { pngdeer }` type-checks in eslint.config.ts and
// typescript-eslint configs, without depending on eslint's own types (ESLint is optional).
declare const plugin: {
  meta: { name: "pngdeer"; version: string };
  rules: {
    "compressible-image": {
      meta: {
        type: "suggestion";
        docs: { description: string; recommended: boolean; url: string };
        messages: Record<string, string>;
        schema: object[];
        defaultOptions: [Required<CompressibleImageOptions>];
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      create(context: any): Record<string, (node: any) => void>;
    };
  };
};

export default plugin;
