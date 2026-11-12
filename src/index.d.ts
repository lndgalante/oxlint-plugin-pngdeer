/** Options of the `slimdeer/compressible-image` rule (docs/rules/compressible-image.md). */
export interface CompressibleImageOptions {
  /** Report only savings of at least this many bytes. Default 4096. */
  minSavedBytes?: number;
  /** ...and of at least this percent of the file. Default 10. */
  minSavedPercent?: number;
  /** The SSIMULACRA2 score to keep, 0-100, or "auto" (about TinyPNG's quality). Default "auto". */
  target?: "auto" | number;
  /** When to measure images not in the cache. Default "auto". */
  measure?: "auto" | "always" | "never";
  /** Measure all project images or only images named by linted files. Default "project". */
  scan?: "project" | "referenced";
  /**
   * Excluded image files or directories, relative to the project root; supports *, ** and ?. Default [].
   * In a project that depends on gatsby, public/ (its build output) is excluded too, unless
   * settings.slimdeer.publicDirs includes "public".
   */
  exclude?: string[];
}

/** `settings.slimdeer`, shared by every file. */
export interface SlimdeerSettings {
  /**
   * Folders where "/x.png" paths are looked up: in the linted file's folder and each folder above it,
   * nearest first, up to the project root, then in the root. Default ["public", "static"], or
   * ["static"] in a project that depends on gatsby.
   */
  publicDirs?: string[];
  /** Path prefixes and the folders they stand for. Default: the project's tsconfig/jsconfig paths, else { "@/": "src/", "~/": "src/" }. */
  aliases?: Record<string, string | string[]>;
  /** Where results are kept, relative to the project root: a folder you can commit. Default node_modules/.cache/slimdeer. */
  cacheDir?: string;
}

// Shaped like an ESLint plugin, so `plugins: { slimdeer }` and `slimdeer.configs.recommended`
// type-check in eslint.config.ts and typescript-eslint configs, without depending on eslint's own
// types (ESLint is optional).
export interface SlimdeerPlugin {
  meta: { name: "slimdeer"; version: string };
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
  /** For ESLint: turns the rule on for the files the rest of the config lints. */
  configs: {
    recommended: {
      name: "slimdeer/recommended";
      plugins: { slimdeer: SlimdeerPlugin };
      rules: { "slimdeer/compressible-image": "warn" };
    };
  };
}

declare const plugin: SlimdeerPlugin;
export default plugin;
