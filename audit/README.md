# jev-audit

Offline audits for recorded [Jev](https://docs.typesafe.ai) results. No API key and no model calls.

| audit | what it tells you |
| --- | --- |
| confidently wrong | every case wrong at >= 0.9 confidence, with one-direction fields flagged as question defects |
| calibration | the confidence scalar and the full distribution, against observed accuracy |
| top-2 recall | what showing a person two labels is worth |
| gate | the lowest threshold that hits a target precision, and how much it automates |
| diff | before/after per field: fixed, broken, flipped, and a sign test |

```bash
npx jev-audit results.jsonl
npx jev-audit diff before.jsonl after.jsonl
```

```js
import { items, parseRows, confidentlyWrong, calibration, fitGate, diff } from 'jev-audit';
```

Input is one JSON object per line: `{ caseId, gold: { field: label }, raw: { field: <Jev answer> } }`.
MIT licensed.
