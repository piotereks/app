import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = readFileSync(join(root, 'audioSpectrum.js'), 'utf8');
const lines = src.split('\n');

const START_LINE = '        // AI ringfenced start - models are forbidden to chane this line ';
const FORMULA_LINE = '\t\tconst secondsPerFrame = analyser.fftSize  / audioContext.sampleRate / 12;';
const END_LINE = '\t\t// AI ringfenced end ';

const idx = lines.findIndex((l) => l.includes('AI ringfenced start'));
assert.notEqual(idx, -1, 'ringfence start marker missing from audioSpectrum.js');
assert.equal(lines[idx], START_LINE, 'ringfence start marker changed');
assert.equal(lines[idx + 1], FORMULA_LINE, 'secondsPerFrame formula line changed');
assert.equal(lines[idx + 2], END_LINE, 'ringfence end marker changed');

console.log('ringfence OK: secondsPerFrame formula unchanged');