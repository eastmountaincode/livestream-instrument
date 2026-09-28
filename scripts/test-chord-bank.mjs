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
const { buildRelatedChordBank, buildChordNotes, getChordLabel, CHORD_TYPES } = await import(
  `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`
);

assert.deepEqual(
  buildRelatedChordBank({ root: 9, type: 'maj', inversion: 0 }).map(getChordLabel),
  ['A', 'Bm', 'C#m', 'D', 'E', 'F#m', 'G#dim', 'A'],
);
assert.deepEqual(
  buildRelatedChordBank({ root: 9, type: 'min', inversion: 0 }).map(getChordLabel),
  ['Am', 'Bdim', 'C', 'Dm', 'Em', 'F', 'G', 'Am'],
);

// Check the actual sounding pitches, including diminished chords and roots
// that wrap past B, against the selected key for every major/minor tonic.
for (let root = 0; root < 12; root++) {
  for (const [type, scale] of [
    ['maj', [0, 2, 4, 5, 7, 9, 11]],
    ['min', [0, 2, 3, 5, 7, 8, 10]],
  ]) {
    const chord = { root, type, inversion: 1 };
    const bank = buildRelatedChordBank(chord);
    assert.equal(bank.length, 8);
    assert.deepEqual(bank[0], chord);
    assert.deepEqual(bank[7], chord);
    for (let degree = 0; degree < 7; degree++) {
      assert.equal(bank[degree].root, (root + scale[degree]) % 12);
      const expected = [0, 2, 4].map(step => (root + scale[(degree + step) % 7]) % 12).sort();
      const actual = buildChordNotes(bank[degree]).map(note => note % 12).sort();
      assert.deepEqual(actual, expected);
    }
  }
}

// Extended or ambiguous chords retain their exact chosen voicing on 1 and 8.
for (const type of Object.keys(CHORD_TYPES)) {
  const chord = Object.freeze({ root: 5, type, inversion: 1 });
  const bank = buildRelatedChordBank(chord);
  assert.deepEqual(bank[0], chord);
  assert.deepEqual(bank[7], chord);
  assert.notEqual(bank[0], bank[7]);
  assert.ok(bank.every(item => CHORD_TYPES[item.type]));
}
assert.equal(buildRelatedChordBank({ root: 5, type: 'min11', inversion: 2 })[1].type, 'dim');
console.log('Chord bank checks passed: A major/minor, all 24 keys, and every selected chord quality.');
