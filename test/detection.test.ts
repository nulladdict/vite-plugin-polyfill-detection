import { suite, test } from "node:test";
import assert from "node:assert/strict";
import { detectPolyfills } from "../index.ts";
import type { Options } from "../index.ts";

async function detect(code: string, targets: Options["targets"]): Promise<Set<string>> {
  const polyfills = new Set<string>();
  await detectPolyfills(code, targets, polyfills);
  return polyfills;
}

function hasPolyfill(polyfills: Set<string>, fragment: string): boolean {
  return [...polyfills].some((p) => p.includes(fragment));
}

suite("polyfill detection", () => {
  suite("detects needed polyfills for old targets", () => {
    const oldTargets = "chrome 60";

    test("detects Array.prototype.flat", async () => {
      const polyfills = await detect(`const result = [1, [2, 3]].flat();`, oldTargets);
      assert.ok(
        hasPolyfill(polyfills, "es.array.flat"),
        `Expected polyfill for Array.prototype.flat, got: ${[...polyfills].join(", ")}`,
      );
    });

    test("detects Array.prototype.flatMap", async () => {
      const polyfills = await detect(
        `const result = [1, 2, 3].flatMap(x => [x, x * 2]);`,
        oldTargets,
      );
      assert.ok(
        hasPolyfill(polyfills, "es.array.flat-map"),
        `Expected polyfill for Array.prototype.flatMap, got: ${[...polyfills].join(", ")}`,
      );
    });

    test("detects Object.fromEntries", async () => {
      const polyfills = await detect(
        `const obj = Object.fromEntries([["a", 1], ["b", 2]]);`,
        oldTargets,
      );
      assert.ok(
        hasPolyfill(polyfills, "es.object.from-entries"),
        `Expected polyfill for Object.fromEntries, got: ${[...polyfills].join(", ")}`,
      );
    });

    test("detects String.prototype.replaceAll", async () => {
      const polyfills = await detect(`const text = "hello".replaceAll("l", "r");`, oldTargets);
      assert.ok(
        hasPolyfill(polyfills, "es.string.replace-all"),
        `Expected polyfill for String.prototype.replaceAll, got: ${[...polyfills].join(", ")}`,
      );
    });

    test("detects multiple polyfills from one code block", async () => {
      const polyfills = await detect(
        `
        const flat = [1, [2]].flat();
        const obj = Object.fromEntries([["a", 1]]);
        const text = "hello".replaceAll("l", "r");
        `,
        oldTargets,
      );
      assert.ok(hasPolyfill(polyfills, "es.array.flat"), "Missing Array.prototype.flat polyfill");
      assert.ok(
        hasPolyfill(polyfills, "es.object.from-entries"),
        "Missing Object.fromEntries polyfill",
      );
      assert.ok(
        hasPolyfill(polyfills, "es.string.replace-all"),
        "Missing String.prototype.replaceAll polyfill",
      );
    });

    test("accumulates polyfills across multiple calls into the same set", async () => {
      const polyfills = new Set<string>();
      await detectPolyfills(`[1, [2]].flat();`, oldTargets, polyfills);
      await detectPolyfills(`Object.fromEntries([["a", 1]]);`, oldTargets, polyfills);
      assert.ok(hasPolyfill(polyfills, "es.array.flat"), "Missing flat polyfill");
      assert.ok(hasPolyfill(polyfills, "es.object.from-entries"), "Missing fromEntries polyfill");
    });
  });

  suite("detects no polyfills for modern targets", () => {
    const modernTargets = "chrome 120";

    test("no polyfills for Array.prototype.flat", async () => {
      const polyfills = await detect(`const result = [1, [2, 3]].flat();`, modernTargets);
      assert.equal(polyfills.size, 0, `Expected no polyfills, got: ${[...polyfills].join(", ")}`);
    });

    test("no polyfills for Object.fromEntries", async () => {
      const polyfills = await detect(`const obj = Object.fromEntries([["a", 1]]);`, modernTargets);
      assert.equal(polyfills.size, 0, `Expected no polyfills, got: ${[...polyfills].join(", ")}`);
    });

    test("no polyfills for String.prototype.replaceAll", async () => {
      const polyfills = await detect(`const text = "hello".replaceAll("l", "r");`, modernTargets);
      assert.equal(polyfills.size, 0, `Expected no polyfills, got: ${[...polyfills].join(", ")}`);
    });
  });

  suite("detects no polyfills for simple code", () => {
    test("basic arithmetic and variables", async () => {
      const polyfills = await detect(
        `const x = 1 + 2; const y = "hello"; console.log(x, y);`,
        "chrome 60",
      );
      assert.equal(polyfills.size, 0, `Expected no polyfills, got: ${[...polyfills].join(", ")}`);
    });

    test("arrow functions and template literals with modern-enough target", async () => {
      const polyfills = await detect(
        `const fn = (x) => \`result: \${x}\`; console.log(fn(42));`,
        "chrome 60",
      );
      assert.equal(polyfills.size, 0, `Expected no polyfills, got: ${[...polyfills].join(", ")}`);
    });
  });

  suite("target formats", () => {
    test("accepts string targets", async () => {
      const polyfills = await detect(`[].flat();`, "chrome 60");
      assert.ok(polyfills.size > 0);
    });

    test("accepts array targets", async () => {
      const polyfills = await detect(`[].flat();`, ["chrome 60", "firefox 60"]);
      assert.ok(polyfills.size > 0);
    });

    test("accepts object targets", async () => {
      const polyfills = await detect(`[].flat();`, { chrome: "60", firefox: "60" });
      assert.ok(polyfills.size > 0);
    });
  });
});
