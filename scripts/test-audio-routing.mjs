import { Buffer } from "node:buffer";
import { URL } from "node:url";
import console from "node:console";
import process from "node:process";
// Sample-level regression tests in a software Web Audio renderer.
// Hardware mapping must additionally be verified in a browser and the DAW.
import fs from "node:fs";
import ts from "typescript";
import webAudioEngine from "web-audio-engine";
const { OfflineAudioContext } = webAudioEngine;
// The renderer exposes EventTarget dispatch through its implementation.
OfflineAudioContext.prototype.dispatchEvent = function (event) {
  this._impl.dispatchEvent(event);
};
const sourceRoot = new URL("../src/services/", import.meta.url);
const codeURL = (code) =>
  `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
const compile = (name) =>
  ts.transpileModule(fs.readFileSync(new URL(name, sourceRoot), "utf8"), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ES2022,
    },
  }).outputText;
const outputURL = codeURL(compile("audioOutput.ts"));
const routerURL = codeURL(
  compile("audioOutputRouter.ts").replace(
    '"./audioOutput"',
    JSON.stringify(outputURL),
  ),
);

const results = { textContent: "" };
let passed = 0,
  failed = 0;
function check(value, message) {
  if (!value) throw Error(message);
}
{
  const app = "audio router";
  const { createAudioOutputRouter } = await import(routerURL);
  const {
    AUDIO_OUTPUT_CHANNELS,
    readAudioOutputChannelPreference,
    writeAudioOutputChannelPreference,
  } = await import(outputURL);
  async function test(name, run) {
    try {
      await run();
      results.textContent += `PASS ${app}: ${name}\n`;
      passed++;
    } catch (e) {
      results.textContent += `FAIL ${app}: ${name}: ${e.stack}\n`;
      failed++;
    }
  }
  for (const option of AUDIO_OUTPUT_CHANNELS.slice(0, 8)) {
    for (const mono of [false, true])
      await test(`${option.label}, ${mono ? "mono duplication" : "stereo separation"}`, async () => {
        const ctx = new OfflineAudioContext(16, 512, 48000),
          router = createAudioOutputRouter(ctx);
        const source = ctx.createBufferSource();
        source.buffer = ctx.createBuffer(mono ? 1 : 2, 512, 48000);
        source.buffer.getChannelData(0).fill(0.125);
        if (!mono) source.buffer.getChannelData(1).fill(-0.25);
        source.connect(router.input);
        router.setChannel(option.value);
        source.start();
        const rendered = await ctx.startRendering();
        const left =
          option.value === "stereo" ? 0 : Number(option.value.slice(5)) - 1;
        for (let ch = 0; ch < 16; ch++)
          for (const value of rendered.getChannelData(ch))
            check(
              Math.abs(
                value -
                  (ch === left
                    ? 0.125
                    : ch === left + 1
                      ? mono
                        ? 0.125
                        : -0.25
                      : 0),
              ) < 1e-6,
              `wrong signal on channel ${ch + 1}: ${value}`,
            );
        router.dispose();
      });
  }
  await test("changing pair removes old route", async () => {
    const ctx = new OfflineAudioContext(16, 512, 48000),
      router = createAudioOutputRouter(ctx),
      src = ctx.createConstantSource();
    src.offset.value = 0.125;
    src.connect(router.input);
    router.setChannel("pair-3");
    router.setChannel("pair-15");
    router.setChannel("pair-3");
    src.start();
    const b = await ctx.startRendering();
    for (let ch = 0; ch < 16; ch++)
      check(
        b
          .getChannelData(ch)
          .every(
            (x) => Math.abs(x - (ch === 2 || ch === 3 ? 0.125 : 0)) < 1e-6,
          ),
        `leaked/doubled channel ${ch + 1}`,
      );
  });
  await test("unsupported pair mutes; explicit stereo selection recovers", async () => {
    const ctx = new OfflineAudioContext(2, 512, 48000),
      router = createAudioOutputRouter(ctx),
      src = ctx.createConstantSource();
    src.connect(router.input);
    let rejected = false;
    try {
      router.setChannel("pair-3");
    } catch {
      rejected = true;
    }
    check(rejected, "did not reject");
    src.start();
    const b = await ctx.startRendering();
    check(
      b.getChannelData(0).every((x) => x === 0) &&
        b.getChannelData(1).every((x) => x === 0),
      "wrong-channel fallback",
    );
    const second = new OfflineAudioContext(2, 512, 48000),
      r = createAudioOutputRouter(second),
      s = second.createConstantSource();
    s.connect(r.input);
    try {
      r.setChannel("pair-3");
    } catch {
      /* Expected unsupported pair. */
    }
    r.setChannel("stereo");
    s.start();
    const rendered = await second.startRendering();
    check(
      rendered.getChannelData(0)[0] === 1 &&
        rendered.getChannelData(1)[0] === 1,
      "recovery failed",
    );
  });
  await test("legacy mono side routing", async () => {
    for (const side of ["left", "right"]) {
      const ctx = new OfflineAudioContext(16, 512, 48000),
        r = createAudioOutputRouter(ctx),
        s = ctx.createConstantSource();
      s.offset.value = 0.125;
      s.connect(r.input);
      r.setChannel(side);
      s.start();
      const b = await ctx.startRendering();
      for (let ch = 0; ch < 16; ch++)
        check(
          b
            .getChannelData(ch)
            .every((x) =>
              ch === (side === "left" ? 0 : 1) ? x > 0 : Math.abs(x) < 1e-6,
            ),
          `wrong mono side ${ch}`,
        );
    }
  });
  await test("old and new preferences round-trip; malformed preference fallback", () => {
    const values = new Map(),
      storage = {
        getItem: (k) => values.get(k),
        setItem: (k, v) => values.set(k, v),
      };
    for (const { value } of AUDIO_OUTPUT_CHANNELS) {
      writeAudioOutputChannelPreference(storage, value);
      check(
        readAudioOutputChannelPreference(storage) === value,
        "preference lost",
      );
    }
    check(
      readAudioOutputChannelPreference({ getItem: () => "pair-99" }) ===
        "stereo",
      "invalid preference",
    );
  });
  await test("sink change mutes and requires device reselection", async () => {
    const ctx = new OfflineAudioContext(16, 512, 48000),
      r = createAudioOutputRouter(ctx),
      s = ctx.createConstantSource();
    s.connect(r.input);
    ctx.dispatchEvent({ type: "sinkchange" });
    let rejected = false;
    try {
      r.setChannel("stereo");
    } catch {
      rejected = true;
    }
    check(rejected, "re-enabled fallback sink");
    s.start();
    const b = await ctx.startRendering();
    check(
      b.getChannelData(0).every((x) => x === 0),
      "fallback leaked",
    );
  });
  await test("device switch remains muted until pair is reapplied; late sink event is safe", async () => {
    const ctx = new OfflineAudioContext(16, 512, 48000),
      r = createAudioOutputRouter(ctx),
      s = ctx.createConstantSource();
    ctx.setSinkId = async (id) => {
      ctx.sinkId = id;
      ctx.dispatchEvent({ type: "sinkchange" });
    };
    s.offset.value = 0.125;
    s.connect(r.input);
    r.setChannel("pair-3");
    await r.setDevice("blackhole");
    r.setChannel("pair-3");
    ctx.dispatchEvent({ type: "sinkchange" });
    // web-audio-engine caches destination buffers at construction. Refresh the
    // cache after changing width; native AudioContext sink negotiation is still
    // a separate browser/hardware check.
    ctx.destination._impl._destinationChannelData =
      ctx.destination._impl.inputs[0].bus.getChannelData();
    s.start();
    const b = await ctx.startRendering();
    for (let ch = 0; ch < 16; ch++)
      check(
        b
          .getChannelData(ch)
          .every(
            (x) => Math.abs(x - (ch === 2 || ch === 3 ? 0.125 : 0)) < 1e-6,
          ),
        `wrong switch mapping ch ${ch}: ${b.getChannelData(ch)[0]}, width ${ctx.destination.channelCount}, max ${ctx.destination.maxChannelCount}`,
      );
  });
  await test("failed sink cannot be unmuted by changing pair", async () => {
    const ctx = new OfflineAudioContext(16, 512, 48000),
      r = createAudioOutputRouter(ctx),
      s = ctx.createConstantSource();
    s.connect(r.input);
    ctx.setSinkId = async () => {
      throw Error("Missing device");
    };
    let failed = false;
    try {
      await r.setDevice("missing");
    } catch {
      failed = true;
    }
    check(failed, "missing sink accepted");
    let rejected = false;
    try {
      r.setChannel("stereo");
    } catch {
      rejected = true;
    }
    check(rejected, "old sink unmuted");
    s.start();
    const b = await ctx.startRendering();
    for (let ch = 0; ch < 16; ch++)
      check(
        b.getChannelData(ch).every((x) => x === 0),
        "stale sink leaked",
      );
  });
}
results.textContent += `\n${passed} passed; ${failed} failed.`;
console.log(results.textContent);
if (failed) process.exitCode = 1;
