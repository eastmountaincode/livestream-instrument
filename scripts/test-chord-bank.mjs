import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Buffer } from 'node:buffer';
import { URL } from 'node:url';
import console from 'node:console';
import ts from 'typescript';

const source = readFileSync(new URL('../src/music/chords.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
});
const { buildRelatedChordBank, buildChordNotes, getChordLabel, normalizeChordSpec, setChordBankPad, PAD_DISPLAY_ORDER, CHORD_TYPES } = await import(
  `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`
);

assert.deepEqual(
  buildRelatedChordBank({ root: 4, type: 'min11', inversion: 0 }).map(getChordLabel),
  ['Em11', 'Fmaj9', 'F#m11', 'Gm11', 'Dm11', 'Dmaj9', 'Am11', 'Bm11'],
);
assert.deepEqual(
  buildRelatedChordBank({ root: 9, type: 'min9', inversion: 0 }).map(getChordLabel),
  ['Am9', 'A#maj9', 'Bm11', 'Cm11', 'Gm11', 'Gmaj9', 'Dm9', 'Em9'],
);
assert.deepEqual(
  buildRelatedChordBank({ root: 9, type: 'maj', inversion: 0 }).map(getChordLabel),
  ['A', 'A#maj9', 'Bm11', 'Cm11', 'Gm11', 'Gmaj9', 'C#m', 'G#m'],
);

// The original minor palette keeps the selected quality at the fourth and
// fifth, including the same extensions: Em11 -> Am11 and Bm11.
for (let root = 0; root < 12; root++) {
  for (const type of ['min', 'min6', 'min7', 'min9', 'min11']) {
    const chord = Object.freeze({ root, type, inversion: 1 });
    const bank = buildRelatedChordBank(chord);
    assert.equal(bank.length, 8);
    assert.deepEqual(bank[0], chord);
    assert.deepEqual(bank.map(item => item.root), [0, 1, 2, 3, 10, 10, 5, 7].map(offset => (root + offset) % 12));
    assert.equal(bank[6].type, type);
    assert.equal(bank[7].type, type);
    assert.deepEqual(buildChordNotes(bank[7]), buildChordNotes({ root: (root + 7) % 12, type, inversion: 0 }));
    assert.ok(bank.slice(1).every(item => item.inversion === 0));
  }
}

// Old banks and sequence events containing the retired altered types must
// still load exactly, even though the builder no longer generates them.
for (const type of Object.keys(CHORD_TYPES)) {
  const chord = Object.freeze({ root: 5, type, inversion: 1 });
  const restored = normalizeChordSpec(JSON.parse(JSON.stringify(chord)));
  assert.deepEqual(restored, chord);
  assert.deepEqual(buildChordNotes(restored), buildChordNotes(chord));
  assert.deepEqual(buildRelatedChordBank(chord)[0], chord);
}
console.log('Chord bank checks passed: original palettes, minor fourth/fifth relationships in every key, and saved-chord compatibility.');

const originalBank = buildRelatedChordBank({ root: 4, type: 'min11', inversion: 0 });
const custom = setChordBankPad(originalBank, 5, { root: 9, type: 'min9', inversion: 2 });
assert.equal(getChordLabel(custom[5]), 'Am9');
assert.equal(custom[5].inversion, 2);
assert.deepEqual(custom.filter((_, i) => i !== 5), originalBank.filter((_, i) => i !== 5));
const cleared = setChordBankPad(custom, 2, null);
assert.equal(cleared.length, 8);
assert.equal(cleared[2], null);
assert.deepEqual(cleared[5], custom[5], 'clearing a pad never shifts other MIDI assignments');
assert.deepEqual(PAD_DISPLAY_ORDER.map(i => i + 1), [5, 6, 7, 8, 1, 2, 3, 4]);
assert.equal(setChordBankPad(originalBank, 8, null), originalBank);
console.log('Custom pad checks passed: assignment, inversion, stable slot numbers, and MPK display order.');
