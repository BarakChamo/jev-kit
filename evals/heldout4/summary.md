## Procurement

| author | arm | maps | retried | failed | accuracy | loaded accuracy | wrong decisions |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Claude Code agent | no plugin | 3 | 0 | 0 | 67.4% | 67.4% | 8 / 144 |
| Claude Code agent | v4.2 | 3 | 0 | 0 | 84.0% | 84.0% | 0 / 144 |
| Claude Code agent | v4.3 | 3 | 0 | 0 | 99.3% | 99.3% | 0 / 144 |
| GLM 5.3 | no plugin | 3 | 1 | 0 | 74.3% | 74.3% | 16 / 144 |
| GLM 5.3 | v4.2 | 3 | 3 | 0 | 59.7% | 59.7% | 0 / 144 |
| GLM 5.3 | v4.3 | 3 | 2 | 0 | 68.1% | 68.1% | 2 / 144 |
| Qwen 3.8 Max (0902) | no plugin | 3 | 0 | 0 | 83.3% | 83.3% | 10 / 144 |
| Qwen 3.8 Max (0902) | v4.2 | 3 | 3 | 3 | 0.0% | nan% | 0 / 0 |
| Qwen 3.8 Max (0902) | v4.3 | 3 | 3 | 3 | 0.0% | nan% | 0 / 0 |
| DeepSeek V4 Pro (0813) | no plugin | 3 | 0 | 0 | 82.6% | 82.6% | 18 / 144 |
| DeepSeek V4 Pro (0813) | v4.2 | 3 | 0 | 0 | 90.3% | 90.3% | 1 / 144 |
| DeepSeek V4 Pro (0813) | v4.3 | 3 | 0 | 0 | 96.5% | 96.5% | 0 / 144 |
| **all authors** | no plugin | 12 | 1 | 0 | 76.9% | 76.9% | 52 / 576 |
| **all authors** | v4.2 | 12 | 6 | 3 | 58.5% | 78.0% | 1 / 432 |
| **all authors** | v4.3 | 12 | 5 | 3 | 66.0% | 88.0% | 2 / 432 |

## Earlier tasks: v4.3 against round 2 v4.2

| author | task | v4.2 loaded accuracy (wrong) | v4.3 loaded accuracy (wrong) | v4.2 / v4.3 failed |
| --- | --- | ---: | ---: | ---: |
| GLM 5.3 | sla-breach | nan% (0/0) | 56.7% (0/60) | 3/3 · 1/3 |
| GLM 5.3 | culprit | 83.3% (0/90) | 75.6% (0/90) | 0/3 · 0/3 |
| GLM 5.3 | access-request | 100.0% (0/30) | 100.0% (0/90) | 2/3 · 0/3 |
| Qwen 3.8 Max (0902) | sla-breach | 93.3% (0/60) | 93.3% (0/30) | 1/3 · 2/3 |
| Qwen 3.8 Max (0902) | culprit | 78.9% (0/90) | 84.4% (0/90) | 0/3 · 0/3 |
| Qwen 3.8 Max (0902) | access-request | 94.4% (0/90) | 100.0% (0/90) | 0/3 · 0/3 |
| DeepSeek V4 Pro (0813) | sla-breach | 93.3% (0/60) | 93.3% (0/90) | 0/2 · 0/3 |
| DeepSeek V4 Pro (0813) | culprit | 90.0% (0/60) | 84.4% (0/90) | 0/2 · 0/3 |
| DeepSeek V4 Pro (0813) | access-request | 100.0% (0/60) | 98.9% (0/90) | 0/2 · 0/3 |
