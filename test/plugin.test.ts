import { suite, test } from "node:test";
import assert from "node:assert/strict";
import polyfillDetection from "../index.ts";

suite("plugin structure", () => {
  const plugins = polyfillDetection({ targets: "chrome 60" });

  test("returns an array of 3 plugins", () => {
    assert.ok(Array.isArray(plugins));
    assert.equal(plugins.length, 3);
  });

  test("has correct plugin names", () => {
    const [detect, build, inject] = plugins;
    assert.equal(detect?.name, "polyfill-detection:detect");
    assert.equal(build?.name, "polyfill-detection:build");
    assert.equal(inject?.name, "polyfill-detection:inject");
  });

  test("all plugins apply to build only", () => {
    for (const plugin of plugins) {
      assert.equal(plugin.apply, "build");
    }
  });

  test("detect plugin uses enforce: post", () => {
    const [detect] = plugins;
    assert.equal(detect?.enforce, "post");
  });

  test("build and inject plugins do not set enforce", () => {
    const [, build, inject] = plugins;
    assert.equal(build?.enforce, undefined);
    assert.equal(inject?.enforce, undefined);
  });

  test("detect plugin has configResolved, renderStart, and renderChunk hooks", () => {
    const [detect] = plugins;
    assert.ok(detect != null);
    assert.equal(typeof detect.configResolved, "function");
    assert.equal(typeof detect.renderStart, "function");
    assert.equal(typeof detect.renderChunk, "function");
  });

  test("build plugin has generateBundle hook", () => {
    const [, build] = plugins;
    assert.ok(build != null);
    assert.equal(typeof build.generateBundle, "function");
  });

  test("inject plugin has transformIndexHtml hook", () => {
    const [, , inject] = plugins;
    assert.ok(inject != null);
    assert.equal(typeof inject.transformIndexHtml, "function");
  });
});

suite("plugin instances are independent", () => {
  test("separate calls return independent plugin sets", () => {
    const a = polyfillDetection({ targets: "chrome 60" });
    const b = polyfillDetection({ targets: "chrome 120" });
    assert.notEqual(a, b);
    assert.notEqual(a[0], b[0]);
  });
});
