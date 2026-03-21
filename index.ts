import path from "node:path";
import { transform } from "@swc/core";
import { build, normalizePath } from "vite";
import type { Plugin, ResolvedConfig } from "vite";
import type {
  EmittedPrebuiltChunk,
  NormalizedOutputOptions,
  OutputBundle,
  OutputChunk,
  RenderedChunk,
} from "rolldown";

export interface Options {
  targets: string | string[] | Record<string, string>;
}

const polyfillRe = /import\s+["'](core-js\/[^"']+)["']/g;

let coreJsVersionCache: string | undefined;
async function getCoreJsVersion(): Promise<string> {
  if (coreJsVersionCache == null) {
    const {
      default: { version },
    } = (await import("core-js/package.json", { with: { type: "json" } })) as {
      default: { version: string };
    };
    coreJsVersionCache = version;
  }
  return coreJsVersionCache;
}

async function detectPolyfills(
  code: string,
  targets: Options["targets"],
  polyfills: Set<string>,
): Promise<void> {
  const coreJsVersion = await getCoreJsVersion();
  const result = await transform(code, {
    filename: "polyfill-detect.js",
    jsc: { parser: { syntax: "ecmascript" } },
    env: {
      targets,
      mode: "usage",
      coreJs: coreJsVersion,
    },
    module: { type: "es6" },
    isModule: true,
  });
  for (const match of result.code.matchAll(polyfillRe)) {
    if (match[1] != null) {
      polyfills.add(match[1]);
    }
  }
}

const polyfillId = "\0polyfill-detection/polyfills";

function polyfillsPlugin(imports: Set<string>): Plugin {
  return {
    name: "polyfill-detection:virtual",
    resolveId(id) {
      if (id === polyfillId) return id;
    },
    load(id) {
      if (id === polyfillId) {
        return [...imports].map((i) => `import ${JSON.stringify(i)};`).join("");
      }
    },
  };
}

function toAssetPathFromHtml(filename: string, htmlPath: string, config: ResolvedConfig): string {
  const relativeUrlPath = normalizePath(path.relative(config.root, htmlPath));
  const toRelative = (f: string) => {
    const base =
      config.base === "./" || config.base === ""
        ? path.posix.join(path.posix.relative(relativeUrlPath, "").slice(0, -2), "./")
        : config.base;
    return base + f;
  };

  const { renderBuiltUrl } = config.experimental;
  let relative = config.base === "" || config.base === "./";

  if (renderBuiltUrl) {
    const result = renderBuiltUrl(filename, {
      hostId: htmlPath,
      hostType: "html",
      type: "asset",
      ssr: !!config.build.ssr,
    });
    if (typeof result === "object") {
      if (result.runtime) {
        throw new Error(
          `{ runtime: "${result.runtime}" } is not supported for assets in html files: ${filename}`,
        );
      }
      if (typeof result.relative === "boolean") {
        relative = result.relative;
      }
    } else if (result) {
      return result;
    }
  }

  if (relative && !config.build.ssr) {
    return toRelative(filename);
  }
  let a = config.base;
  const b = filename.startsWith("/") ? filename : "/" + filename;
  if (a.endsWith("/")) {
    a = a.substring(0, a.length - 1);
  }
  return a + b;
}

type ChunkPolyfillMap = Map<string, Set<string>>;

export default function polyfillDetection(options: Options): Plugin[] {
  let config: ResolvedConfig;

  const outputToChunkPolyfills = new WeakMap<NormalizedOutputOptions, ChunkPolyfillMap | null>();
  const facadeToPolyfillFileName = new Map<string, string>();

  const detectPlugin: Plugin = {
    name: "polyfill-detection:detect",
    apply: "build",
    enforce: "post",
    configResolved(resolvedConfig) {
      config = resolvedConfig;
    },
    renderStart(opts) {
      outputToChunkPolyfills.set(opts, null);
      facadeToPolyfillFileName.clear();
    },
    async renderChunk(
      code: string,
      chunk: RenderedChunk,
      opts: NormalizedOutputOptions,
      { chunks }: { chunks: Record<string, RenderedChunk> },
    ) {
      if (config.build.ssr) return;

      let chunkPolyfills = outputToChunkPolyfills.get(opts);
      if (chunkPolyfills == null) {
        chunkPolyfills = new Map();
        for (const fileName in chunks) {
          chunkPolyfills.set(fileName, new Set());
        }
        outputToChunkPolyfills.set(opts, chunkPolyfills);
      }

      const polyfills = chunkPolyfills.get(chunk.fileName);
      if (polyfills == null) {
        throw new Error(
          `Internal polyfill-detection error: polyfill set for ${chunk.fileName} should exist`,
        );
      }

      await detectPolyfills(code, options.targets, polyfills);
    },
  };

  const buildPlugin: Plugin = {
    name: "polyfill-detection:build",
    apply: "build",
    async generateBundle(opts: NormalizedOutputOptions, bundle: OutputBundle) {
      if (config.build.ssr) return;

      const chunkPolyfills = outputToChunkPolyfills.get(opts);
      if (chunkPolyfills == null) {
        throw new Error("Internal polyfill-detection error: discovered polyfills should exist");
      }

      const allPolyfills = new Set<string>();
      for (const polyfills of chunkPolyfills.values()) {
        for (const p of polyfills) {
          allPolyfills.add(p);
        }
      }

      if (allPolyfills.size === 0) return;

      const { minify, assetsDir, sourcemap } = config.build;

      const res = await build({
        mode: config.mode,
        root: path.dirname(new URL(import.meta.url).pathname),
        configFile: false,
        logLevel: "error",
        plugins: [polyfillsPlugin(allPolyfills)],
        build: {
          write: false,
          minify: minify ? "oxc" : false,
          assetsDir,
          sourcemap,
          rollupOptions: {
            input: { polyfills: polyfillId },
            output: {
              format: "es",
              entryFileNames: opts.entryFileNames,
            },
          },
        },
      });

      const buildResult = Array.isArray(res) ? res[0] : res;
      if (!buildResult || !("output" in buildResult)) return;

      const polyfillChunk = buildResult.output.find(
        (c): c is OutputChunk => c.type === "chunk" && c.isEntry,
      );
      if (!polyfillChunk) return;

      for (const entry of Object.values(bundle)) {
        if (entry.type === "chunk" && entry.facadeModuleId) {
          facadeToPolyfillFileName.set(entry.facadeModuleId, polyfillChunk.fileName);
        }
      }

      const emitted: EmittedPrebuiltChunk = {
        type: "prebuilt-chunk",
        fileName: polyfillChunk.fileName,
        code: polyfillChunk.code,
      };
      if (polyfillChunk.name) {
        emitted.name = polyfillChunk.name;
      }
      if (polyfillChunk.facadeModuleId != null) {
        emitted.facadeModuleId = polyfillChunk.facadeModuleId;
      }
      if (polyfillChunk.map != null) {
        emitted.map = polyfillChunk.map;
      }
      if (polyfillChunk.sourcemapFileName != null) {
        emitted.sourcemapFileName = polyfillChunk.sourcemapFileName;
      }
      this.emitFile(emitted);

      if (polyfillChunk.sourcemapFileName) {
        const mapAsset = buildResult.output.find(
          (a) => a.type === "asset" && a.fileName === polyfillChunk.sourcemapFileName,
        );
        if (mapAsset && mapAsset.type === "asset") {
          this.emitFile({
            type: "asset",
            fileName: mapAsset.fileName,
            source: mapAsset.source,
          });
        }
      }
    },
  };

  const injectPlugin: Plugin = {
    name: "polyfill-detection:inject",
    apply: "build",
    transformIndexHtml(html, { chunk }) {
      if (config.build.ssr) return;
      if (!chunk?.facadeModuleId) return;

      const polyfillFileName = facadeToPolyfillFileName.get(chunk.facadeModuleId);
      if (!polyfillFileName) return;

      return [
        {
          tag: "script",
          attrs: {
            type: "module",
            crossorigin: true,
            src: toAssetPathFromHtml(polyfillFileName, chunk.facadeModuleId, config),
          },
        },
      ];
    },
  };

  return [detectPlugin, buildPlugin, injectPlugin];
}
