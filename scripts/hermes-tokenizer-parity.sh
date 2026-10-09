#!/usr/bin/env bash
# Tokenizer parity on a real Hermes VM (laptop): src/engine tokenizer + text rendering vs the Python reference.
#   scripts/hermes-tokenizer-parity.sh      (needs ~/.jsvu/bin/hermes: npx --yes jsvu --os=mac64arm --engines=hermes)
set -euo pipefail
cd "$(dirname "$0")/.."
HERMES="${HERMES:-$HOME/.jsvu/bin/hermes}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

cat >"$TMP/entry.ts" <<EOF
import { XlmrTokenizer } from '$PWD/src/engine/tokenizer';
import { stateText, choiceTexts, normalize } from '$PWD/src/engine/text';
declare const TOK_JSON: object, TOK_CFG: object, REF: any, print: (s: string) => void;
const t0 = Date.now();
const tok = XlmrTokenizer.fromJson(TOK_JSON, TOK_CFG);
print('tokenizer ready in ' + (Date.now() - t0) + ' ms; NFC ok: ' + (normalize('é') === 'é'));
let bad = 0, n = 0;
const cfg = { state_prefix: 'query: ', question_in_state: true };
for (const it of REF.items) for (const k of Object.keys(it.runs)) {
  const r = it.runs[k]; n++;
  const st = stateText(it.state, REF.question, cfg);
  const ok = st === r.stateText && JSON.stringify(tok.encode(st, 512)) === JSON.stringify(r.stateIds)
    && JSON.stringify(choiceTexts(tok, REF.question, r.options, 'passage: ', 64).map((t: string) => tok.encode(t, 64))) === JSON.stringify(r.choiceIds);
  if (!ok) { bad++; print('MISMATCH ' + it.id + '/' + k); }
}
for (const e of REF.tokenizerEdgeCases) { n++; if (JSON.stringify(tok.encode(e.text, e.maxLen)) !== JSON.stringify(e.ids)) { bad++; print('EDGE MISMATCH ' + JSON.stringify(e.text.slice(0, 30))); } }
print('hermes tokenizer parity: ' + (n - bad) + '/' + n + ' match');
EOF

python3 - "$TMP/prelude.js" <<'EOF'
import json, sys
m = 'models/decima-small/onnx/int8/tokenizer/'
r = json.load(open('fixtures/phase0.reference.json'))
slim = {'question': r['question'], 'tokenizerEdgeCases': r['tokenizerEdgeCases'],
        'items': [{'id': i['id'], 'state': i['state'],
                   'runs': {k: {kk: v[kk] for kk in ('stateText', 'stateIds', 'choiceIds', 'options')} for k, v in i['runs'].items()}}
                  for i in r['items']]}
open(sys.argv[1], 'w').write('var TOK_JSON=' + open(m + 'tokenizer.json').read() + ';\nvar TOK_CFG=' +
                             open(m + 'tokenizer_config.json').read() + ';\nvar REF=' + json.dumps(slim) + ';\n')
EOF

npx --yes esbuild@0.25 "$TMP/entry.ts" --bundle --format=iife --target=es2017 --log-level=warning --outfile="$TMP/body.js"
node -e "
const babel = require('@babel/core'); const fs = require('fs');
const out = babel.transformSync(fs.readFileSync('$TMP/body.js', 'utf8'), { babelrc: false, configFile: false,
  plugins: ['@babel/plugin-transform-class-static-block', '@babel/plugin-transform-class-properties',
            '@babel/plugin-transform-private-methods', '@babel/plugin-transform-classes'] });
fs.writeFileSync('$TMP/body.es5.js', out.code);"
cat "$TMP/prelude.js" "$TMP/body.es5.js" >"$TMP/test.js"
"$HERMES" "$TMP/test.js"
