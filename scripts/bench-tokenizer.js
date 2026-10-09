// Builds the XLM-R tokenizer from tokenizer.json and reports construction time and heap growth (Node).
//   node --expose-gc scripts/bench-tokenizer.js
const fs = require('fs');
const path = require('path');
const { Tokenizer } = require('@huggingface/tokenizers');

const dir = path.join(__dirname, '..', 'models/decima-small/onnx/int8/tokenizer');
const json = fs.readFileSync(path.join(dir, 'tokenizer.json'), 'utf8');
const config = JSON.parse(fs.readFileSync(path.join(dir, 'tokenizer_config.json'), 'utf8'));

for (let run = 1; run <= 3; run++) {
  const parsed = JSON.parse(json);
  global.gc?.();
  const heap0 = process.memoryUsage().heapUsed;
  const t0 = performance.now();
  const tok = new Tokenizer(parsed, config);
  const ms = performance.now() - t0;
  const heapMb = (process.memoryUsage().heapUsed - heap0) / 1e6;
  const ids = tok.encode('query: Hindi totoo na nag-resign si Pangulong Marcos.', { add_special_tokens: false }).ids;
  console.log(`run ${run}: construct ${ms.toFixed(0)} ms, heap +${heapMb.toFixed(0)} MB, sample ids ${ids.length}`);
}
