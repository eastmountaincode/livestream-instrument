import assert from 'node:assert/strict';
import console from 'node:console';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import webAudioEngine from 'web-audio-engine';

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const modules = new Map();
const effects = [];
const cleanups = [];
let displayedQ;
let saves = 0;
let nextCallbackId = 1;
const wheelTimers = new Map();
const timers = new Map();
const listeners = new Map();
function flushWheel() {
    const callbacks = [...wheelTimers.values()]; wheelTimers.clear();
    for (const callback of callbacks) callback();
}
function flushTimers() {
    const callbacks = [...timers.values()]; timers.clear();
    for (const callback of callbacks) callback();
}
let saved = JSON.stringify({
    activeStreamIds: ['first', 'second'],
    streams: {
        first: { filterQ: 46, volume: 0.7, levelMatchReferenceQ: 46 },
        second: { filterQ: 65, volume: 0.4, levelMatchReferenceQ: 65 },
    },
    masterVolume: 0.42,
});

// Use real Web Audio nodes and the actual engine, MIDI parser, hook callbacks,
// and storage. Only the browser device and React lifecycle are supplied here.
class TestAudioContext extends webAudioEngine.RenderingAudioContext {
    constructor() {
        super({ sampleRate: 48000, numberOfChannels: 2 });
    }

    createMediaElementSource() {
        const source = this.createBufferSource();
        source.buffer = this.createBuffer(1, 128, this.sampleRate);
        source.buffer.getChannelData(0).fill(0.001);
        source.loop = true;
        source.start();
        return source;
    }
}

const environment = {
    AudioContext: TestAudioContext,
    localStorage: {
        getItem: () => saved,
        setItem: (_key, value) => { saved = value; saves++; },
    },
    window: { setInterval: () => 1, clearInterval: () => {}, setTimeout: () => 1,
        addEventListener: (name, fn) => listeners.set(name, fn),
        removeEventListener: name => listeners.delete(name) },
    setTimeout: (callback, delay) => { const id = nextCallbackId++; if (delay === 150) timers.set(id, callback); if (delay === 16) wheelTimers.set(id, callback); return id; },
    clearTimeout: id => { timers.delete(id); wheelTimers.delete(id); },
    queueMicrotask: callback => Promise.resolve().then(callback),
    console,
};
const reactLifecycle = {
    useState: initialize => {
        displayedQ = initialize();
        return [displayedQ, next => { displayedQ = next; }];
    },
    useRef: current => ({ current }),
    useCallback: callback => callback,
    useEffect: callback => { effects.push(callback); },
};

function load(relativePath) {
    const filename = resolve(root, relativePath);
    if (modules.has(filename)) return modules.get(filename).exports;
    const module = { exports: {} };
    modules.set(filename, module);
    const code = ts.transpileModule(readFileSync(filename, 'utf8'), {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText;
    runInNewContext(code, {
        ...environment,
        exports: module.exports,
        module,
        require: specifier => {
            if (specifier === 'react') return reactLifecycle;
            if (specifier.startsWith('.')) {
                return load(resolve(dirname(filename), `${specifier}.ts`));
            }
            return require(specifier);
        },
    }, { filename });
    return module.exports;
}

const storage = load('src/services/storage.ts');
assert.equal(storage.getGlobalFilterQ(), 46, 'old sessions adopt the first active track Q');
assert.equal(storage.getStreamSettings('second').levelMatchReferenceQ, 65);
storage.saveGlobalFilterQ(75);
storage.saveMasterVolume(0.5);
assert.equal(storage.getGlobalFilterQ(), 75, 'other preference writes preserve the global value');
assert.equal(storage.getStreamSettings('first').volume, 0.7);
assert.equal(storage.getStreamSettings('second').levelMatchReferenceQ, 65, 'migration preserves matching reference');

const { audioEngine } = load('src/services/AudioEngine.ts');
const { midiService } = load('src/services/MidiService.ts');
const { useGlobalResonance } = load('src/hooks/useGlobalResonance.ts');
const control = useGlobalResonance();
for (const effect of effects) {
    const cleanup = effect();
    if (cleanup) cleanups.push(cleanup);
}
assert.equal(audioEngine.getFilterQ(), 75, 'saved resonance applies before streams exist');

audioEngine.addStream('first', {});
audioEngine.addStream('second', {});
audioEngine.setStreamLevelMatch('first', false, 46);
audioEngine.setStreamLevelMatch('second', false, 65);
audioEngine.setStreamVolume('first', 0.7);
audioEngine.setStreamVolume('second', 0.4);
audioEngine.noteOn(60, 90, 'keyboard');

const send = data => midiService.handleMidiMessageEvent({ data: Uint8Array.from(data), timeStamp: 0 });
const assertAllFilters = q => {
    flushWheel();
    flushTimers();
    audioEngine.ctx.processTo(audioEngine.ctx.currentTime + 0.2);
    for (const id of ['first', 'second']) {
        assert.equal(audioEngine.getStreamFilterQ(id), q);
        for (const voice of audioEngine.channels.get(id).voices) {
            assert.equal(voice.filter.Q._impl.getTimeline().at(-1).args[0], q, 'fundamental schedules the global Q');
            if (voice.active) {
                assert.ok(Math.abs(voice.filter.Q.value - q) < 0.001, 'held fundamental follows wheel');
            }
            for (const band of voice.harmonicBands) {
                assert.equal(band.filter.Q._impl.getTimeline().at(-1).args[0], q, 'harmonics schedule the global Q even when disconnected');
            }
        }
    }
    assert.equal(displayedQ, q, 'UI state follows wheel');
    assert.equal(storage.getGlobalFilterQ(), q, 'global resonance is saved');
};

send([0xB0, 1, 0]);
assertAllFilters(1);
send([0xBF, 1, 127]);
assertAllFilters(100);
send([0xB0, 1, 64]);
assertAllFilters(1 + 64 / 127 * 99);
assert.equal(audioEngine.getStreamVolume('first'), 0.7);
assert.equal(audioEngine.getStreamVolume('second'), 0.4);
assert.equal(audioEngine.getStreamLevelMatch('first').referenceQ, 46);
assert.equal(audioEngine.getStreamLevelMatch('second').referenceQ, 65);
assert.deepEqual(Array.from(audioEngine.getActiveNotes()), [60], 'held notes survive sweeps');

const beforePitchBend = audioEngine.getFilterQ();
send([0xE0, 0, 127]);
send([0xB0, 20, 0]);
send([0xB0, 1]);
send([0xB0, 1, 255]);
assert.equal(audioEngine.getFilterQ(), beforePitchBend, 'pitch bend, other CCs and malformed CC1 cannot move resonance');
assert.ok(audioEngine.pitchBendSemitones > 0, 'pitch bend retains its existing function');

control.updateFilterQ(80);
assertAllFilters(80);
send([0xB0, 1, 0]);
assertAllFilters(1);
audioEngine.addStream('later', {});
assert.equal(audioEngine.getStreamFilterQ('later'), 1, 'new streams inherit the latest wheel position');
audioEngine.addStream('first', {});
assert.equal(audioEngine.getStreamFilterQ('first'), 1, 'reconnected streams inherit global resonance');
audioEngine.setFilterQ(Number.NaN);
assert.equal(audioEngine.getFilterQ(), 1);

// Reproduce the expensive case: sustained six-note chords, harmonics and
// Level Match on multiple streams, with a full wheel sweep between control updates.
audioEngine.setToneMode('harmonic-evidence');
for (const note of [48, 55, 58, 62, 65, 69]) audioEngine.noteOn(note, 100, 'chord-pad');
for (const id of ['first', 'second', 'later']) {
    const channel = audioEngine.channels.get(id);
    channel.rawAnalyser.getFloatFrequencyData = bins => bins.fill(-40);
    audioEngine.setStreamLevelMatch(id, true, 30);
}
await Promise.resolve();
let calculations = 0;
for (const channel of audioEngine.channels.values()) {
    channel.rawAnalyser.getFloatFrequencyData = bins => { calculations++; bins.fill(-40); };
}
const savesBeforeSweep = saves;
for (let value = 1; value <= 127; value++) send([0xB0, 1, value]);
assert.equal(calculations, 0, 'MIDI handlers must not calculate spectra per message');
assert.equal(wheelTimers.size, 1, 'one control update handles the entire queued sweep');
flushWheel();
assert.equal(calculations, 3, 'one calculation per stream, not per wheel message');
assert.equal(audioEngine.getFilterQ(), 100, 'latest position wins without a backlog');
assert.equal(saves, savesBeforeSweep, 'continuous wheel movement does not write storage');
flushTimers();
assert.equal(saves, savesBeforeSweep + 1, 'save once after movement settles');
send([0xB0, 1, 127]); flushWheel();
assert.equal(calculations, 3, 'repeated wheel positions do not recalculate');
send([0xB0, 1, 0]);
control.updateFilterQ(70);
flushWheel();
assert.equal(audioEngine.getFilterQ(), 70, 'slider supersedes a queued wheel update');
listeners.get('pagehide')();
assert.equal(storage.getGlobalFilterQ(), 70, 'page exit flushes the last heard setting');
send([0xB0, 1, 127]);
for (const cleanup of cleanups) cleanup();
send([0xB0, 1, 127]);
flushWheel();
assert.equal(audioEngine.getFilterQ(), 70, 'unmount removes the MIDI subscription and pending wheel update');
assert.equal(timers.size, 0, 'unmount clears the save timer');

saved = JSON.stringify({ globalFilterQ: 0 });
assert.equal(storage.getGlobalFilterQ(), 1);
saved = JSON.stringify({ globalFilterQ: 1000 });
assert.equal(storage.getGlobalFilterQ(), 100);
saved = '{}';
assert.equal(storage.getGlobalFilterQ(), 30, 'fresh sessions retain the engine default');
console.log('Global resonance checks passed: MIDI endpoints, held voices and harmonics, new/reconnected streams, slider takeover, migration, persistence, cleanup, and pitch-bend isolation.');
