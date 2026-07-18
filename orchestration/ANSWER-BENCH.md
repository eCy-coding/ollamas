# ANSWER-BENCH — Definitive Answer Doctrine accuracy (offline)

- offline (computable — exactly one right answer): **18/18**
- learned channel scoreboard (from the brain ledger):
  - cloud:groq             4/4 isabet · wilson 0.51
  - cloud:gemini           3/3 isabet · wilson 0.44
  - odysseus-research      1/4 isabet · wilson 0.05

| kind | question | expected | got | ok |
|------|----------|----------|-----|----|
| arithmetic | `2+2=?` | 4 | 4 | ✅ |
| arithmetic | `7*8` | 56 | 56 | ✅ |
| arithmetic | `100-64` | 36 | 36 | ✅ |
| arithmetic | `144/12` | 12 | 12 | ✅ |
| arithmetic | `2^10` | 1024 | 1024 | ✅ |
| arithmetic | `(3+4)*(2+5)` | 49 | 49 | ✅ |
| arithmetic | `-8+3*5` | 7 | 7 | ✅ |
| arithmetic | `0.5*8` | 4 | 4 | ✅ |
| arithmetic | `10/4` | 2.5 | 2.5 | ✅ |
| arithmetic | `2^3^2` | 512 | 512 | ✅ |
| python | `print(sum(range(101)))` | 5050 | 5050 | ✅ |
| python | `print(len('ollamas'))` | 7 | 7 | ✅ |
| javascript | `console.log([1,2,3].reduce((a,b)=>a+b,0))` | 6 | 6 | ✅ |
| javascript | `console.log('ecy'.toUpperCase())` | ECY | ECY | ✅ |
| html | `<!doctype html><div><p>ok<br></p></div>` | well-formed | well-formed | ✅ |
| html | `<ul><li>a</li><li>b</li></ul>` | well-formed | well-formed | ✅ |
| html | `<div><p>bad</div>` | UNVERIFIED | UNVERIFIED | ✅ |
| html | `<div><span></div></span>` | UNVERIFIED | UNVERIFIED | ✅ |

> Floor: offline accuracy MUST be 100% (computable questions are either right or wrong).
> Rerun: `tsx orchestration/bin/answer-bench.ts [--live]`.
