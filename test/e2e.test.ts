import { suite, test, before } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import polyfillDetection from "../index.ts";

const fixtureDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixture");

interface OutputItem {
  type: "chunk" | "asset";
  fileName: string;
  code?: string;
  source?: string | Uint8Array;
  isEntry?: boolean;
}

async function runBuild(targets: string): Promise<OutputItem[]> {
  const result = await build({
    root: fixtureDir,
    configFile: false,
    logLevel: "silent",
    plugins: [polyfillDetection({ targets })],
    build: {
      write: false,
    },
  });

  const buildResult = Array.isArray(result) ? result[0] : result;
  assert.ok(buildResult != null, "Build should produce a result");
  assert.ok("output" in buildResult, "Build result should have output");
  return buildResult.output as OutputItem[];
}

function findChunk(
  output: OutputItem[],
  predicate: (item: OutputItem) => boolean,
): OutputItem | undefined {
  return output.find((item) => item.type === "chunk" && predicate(item));
}

function findAsset(
  output: OutputItem[],
  predicate: (item: OutputItem) => boolean,
): OutputItem | undefined {
  return output.find((item) => item.type === "asset" && predicate(item));
}

function getHtmlContent(output: OutputItem[]): string {
  const html = findAsset(output, (item) => item.fileName.endsWith(".html"));
  assert.ok(html != null, "Build should produce an HTML asset");
  if (typeof html.source === "string") return html.source;
  assert.ok(html.source != null, "HTML asset should have source");
  return new TextDecoder().decode(html.source);
}

suite("end-to-end", () => {
  suite("with old targets needing polyfills", () => {
    let output: OutputItem[];

    before(async () => {
      output = await runBuild("chrome 60");
    });

    test("produces a polyfills chunk", () => {
      const polyfillChunk = findChunk(output, (c) => c.fileName.includes("polyfills"));
      assert.ok(polyfillChunk != null, "Should produce a polyfills chunk");
      assert.ok(
        polyfillChunk.code != null && polyfillChunk.code.length > 0,
        "Polyfill chunk should contain code",
      );
    });

    test("polyfills chunk contains substantial bundled code", () => {
      const polyfillChunk = findChunk(output, (c) => c.fileName.includes("polyfills"));
      assert.ok(polyfillChunk?.code != null);
      // The bundled polyfill chunk should contain actual polyfill implementations,
      // not just import statements (those get bundled into real code)
      assert.ok(polyfillChunk.code.length > 100, "Polyfill chunk should contain substantial code");
    });

    test("injects polyfill script tag into HTML", () => {
      const html = getHtmlContent(output);
      const polyfillChunk = findChunk(output, (c) => c.fileName.includes("polyfills"));
      assert.ok(polyfillChunk != null);
      assert.ok(
        html.includes(polyfillChunk.fileName),
        `HTML should reference polyfill chunk "${polyfillChunk.fileName}"`,
      );
    });

    test("injected script tag has type=module", () => {
      const html = getHtmlContent(output);
      assert.ok(html.includes('type="module"'), "Injected script should have type=module");
    });

    test("injected script tag has crossorigin", () => {
      const html = getHtmlContent(output);
      assert.ok(html.includes("crossorigin"), "Injected script should have crossorigin attribute");
    });

    test("produces both an app chunk and a polyfills chunk", () => {
      const chunks = output.filter((item) => item.type === "chunk");
      assert.ok(chunks.length >= 2, `Expected at least 2 chunks, got ${chunks.length}`);
      const polyfillChunk = chunks.find((c) => c.fileName.includes("polyfills"));
      const appChunk = chunks.find((c) => !c.fileName.includes("polyfills"));
      assert.ok(polyfillChunk != null, "Should have a polyfills chunk");
      assert.ok(appChunk != null, "Should have an app chunk");
    });
  });

  suite("with modern targets not needing polyfills", () => {
    let output: OutputItem[];

    before(async () => {
      output = await runBuild("chrome 120");
    });

    test("does not produce a polyfills chunk", () => {
      const polyfillChunk = findChunk(output, (c) => c.fileName.includes("polyfills"));
      assert.ok(polyfillChunk == null, "Should not produce a polyfills chunk for modern targets");
    });

    test("does not inject a polyfill script tag into HTML", () => {
      const html = getHtmlContent(output);
      // Count script tags - should only have the app entry script, not a polyfill script
      const scriptMatches = html.match(/<script /g);
      assert.ok(scriptMatches != null, "HTML should have at least one script tag");
      assert.equal(
        scriptMatches.length,
        1,
        "HTML should only have the app entry script, no polyfill script",
      );
    });
  });
});
