// Replays a trace file (TRACE=1 writes them under data/traces/) through the attribution as it is
// now, and reports where it decides differently from what was decided live.
//
//   node scripts/replay-trace.mjs data/traces/<file>.jsonl [--all]
//
// Without --all only the fragments that changed are listed.
import { readFile } from 'node:fs/promises';
import { replayTrace } from '../src/trace.js';

const [file, ...flags] = process.argv.slice(2);
if (!file) {
	console.error('usage: node scripts/replay-trace.mjs <trace.jsonl> [--all]');
	process.exit(2);
}
const all = flags.includes('--all');
const records = (await readFile(file, 'utf8'))
	.split('\n')
	.filter(Boolean)
	.map((line) => JSON.parse(line));
const result = replayTrace(records);
const frames = records.filter((record) => record.t === 'a').length;
console.log(`${file}: ${records.length} records, ${frames} voice changes, ${result.total} fragments; ${result.matched}/${result.total} decided the same`);
for (const entry of result.decisions) {
	if (!all && entry.same) continue;
	const mark = entry.same ? ' ' : '!';
	console.log(`${mark} ${entry.rs}-${entry.re} (drift ${entry.drift}) recorded=${entry.recorded ?? '-'} now=${entry.replayed ?? '-'} ${entry.text ? JSON.stringify(entry.text.slice(0, 40)) : ''}`);
}
