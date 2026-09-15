export function exampleEpisode({ capture = "none", interrupt = false } = {}) {
  const prelude = `import assert from 'node:assert/strict'; import {pathToFileURL} from 'node:url'; import {resolve} from 'node:path'; const {sum}=await import(pathToFileURL(resolve(process.env.PROJECT_ROOT,'src/sum.mjs')));`;
  return {
    id: "C01-A",
    setup: {
      files: [
        {
          path: "src/sum.mjs",
          role: "source",
          content: "export const sum = values => values.reduce((a,b)=>a+b);\n",
        },
        {
          path: "README.md",
          role: "documentation",
          content: "# Sum\nSum numeric entries; empty input totals zero.\n",
        },
      ],
    },
    scenario: {
      history: [],
      sessions: [
        {
          objective: "Repair empty input behavior.",
          boundary: interrupt ? "forced-interrupt" : "normal",
          offline_patch: [
            {
              path: "src/sum.mjs",
              content:
                "export const sum=values=>values.reduce((a,b)=>a+b,0);\n",
            },
          ],
        },
        {
          objective:
            "Support numeric strings while retaining empty input behavior.",
          boundary: "normal",
          offline_patch: [
            {
              path: "src/sum.mjs",
              content:
                "export const sum=values=>values.reduce((a,b)=>a+Number(b),0);\n",
            },
            ...(capture === "required"
              ? [
                  {
                    path: ".agents/knowledge/guides/sum.md",
                    content:
                      "# Numeric input\nCoerce at the reducer boundary; preserve empty input identity.\n",
                  },
                ]
              : []),
          ],
        },
      ],
      checks: {
        initial: {
          script:
            prelude + "assert.throws(()=>sum([])); assert.equal(sum([1,2]),3);",
          expected: "pass",
        },
        function: { script: prelude + "assert.equal(sum(['2',3]),5);" },
        regression: {
          script:
            prelude + "assert.equal(sum([]),0); assert.equal(sum([-1,2]),1);",
        },
        architecture: {
          script:
            "import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {resolve} from 'node:path';assert.doesNotMatch(readFileSync(resolve(process.env.PROJECT_ROOT,'src/sum.mjs'),'utf8'),/process\.env/);",
        },
      },
      capture,
      writable_paths: ["src/sum.mjs", ".agents/knowledge/guides/sum.md"],
      durable_paths: [".agents/knowledge/guides/sum.md"],
    },
  };
}
