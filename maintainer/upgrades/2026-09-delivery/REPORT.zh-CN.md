# self-evolution 工程升级交付记录

本地实现与离线验证已落地。真实模型效果、原生记忆与跨 Harness 模型交接证据尚未取得；`standard/core` 与 `continuity/core` 均不可发布。本次没有 push、Release、许可证或全局 Harness 配置变更。

## 起点与分发物

起点/当前 HEAD：`7b608e32412a50a8dcab7f37a89fce4c1ef86548`，`main`；交付为未提交工作区差异。用户原有 `.sanitize-history.mjs` 保持不动。远端 main 本次只读查询为 `2237b5494820d5393fa0f7c160f5c087b0ba68cb`，没有用远端覆盖本地。

B4 保存的是修改前实际分发字节，见 `../2026-09-continuity-baseline.json` 和 `../../evals/engineering/baseline/`；可离线恢复。候选完整字节清单及摘要见 `subjects.json`，变更文件清单见 `files.json`。

| 项目 | B4 | 候选 |
|---|---:|---:|
| 常驻 Skill 行 | 337 | 329 |
| 常驻 Skill 字节 | 16721 | 15973 |
| 分发文件 | 18 | 20 |
| 默认初始化文件 | 3 | 3 |
| 默认 adapter / 新常驻服务 | 0 / 0 | 0 / 0 |
| 新运行依赖 | 0 | 0 |

新增两个按需文件是 continuation 指南和模板。字符、字节、Token 分开；未测 tokenizer/模型生命周期成本，不能把常驻字节减少等同工程效率收益。现有 BSL 1.1 使用与分发约束未改变。

## 十项工作包

| 工作包 | 实际变化 | 验收/限制 |
|---|---|---|
| SE-01 | 24 executable scenario、六 arms、原始 evidence/cost、continuity profile、L2/L3 | 离线编排与源码行为通过；真实配对模型证据 pending |
| SE-02 | full-tree smoke snapshot、实际 version/hash、合法/非法 schema | 新增/删除/修改/类型覆盖；Windows symlink 创建测试因权限跳过 |
| SE-03 | 历史 Decision ID 与当前路由分离，同 scope 按用途/消费者诊断 | 归档不入索引；duplicate/dangling/self/cycle/current authority 有错误检查 |
| SE-04 | continuation/1 模板、actual binary patch/untracked transfer、receiver guards | 新进程恢复、错误分支/缺失篡改材料拒绝；真实跨 Harness 模型运行未测 |
| SE-05 | Guide/Decision 条件—证据—行动—验证入口；C04/C02 后续代码链 | 实际函数/回归/结构验收；fake不能证明模型主动 Capture |
| SE-06 | bounded source details、changed paths/baseline/limitations | committed/staged/unstaged/untracked/delete/rename/SHA/shallow/irrelevant覆盖 |
| SE-07 | 双向 counterfactual scenarios、policy evolution与code drift分开 | 24 catalog actual API断言，避免空断言/标签自证 |
| SE-08 | 各 CLI 参数适配、真实version/help、模型授权与预算校验 | Codex/OpenCode存在；原生读取/生命周期/跨宿主效果not-tested；隔离不足阻止正式运行 |
| SE-09 | 移出推荐/QA规则，聚焦少量知识与工程动作 | Skill 337→329行；模型消融未跑，不能宣称不退化 |
| SE-10 | kb write expected digest+OS mutex、index同锁、temp recovery | Windows/Linux实际竞争进程通过；外部直接编辑仍使用Git合并 |

关键代码：`tools/kb/src/{check,documents,source-check,fs,write-command,index-command}.ts`；按需契约：`skills/self-evolution/references/continuation.md`；维护者工程入口：`maintainer/evals/engineering/README.md`。

## 实际验证

- `npm ci`：退出 0。
- Windows Vitest：10 文件、71 测试通过；Linux 同候选：10 文件、71 测试通过。
- `npm run eval:engineering:test`：本地明确清单 69 测试通过；Linux 同清单 69 通过。远程早期 72 包含3项遗留实验测试，不合并计数。
- 既有 fixture/evidence/public 合约：45/45 通过；13 个旧 fixture 初始 verifier保留。
- `npm run eval:external:test`：122 通过、5 跳过；跳过为已有 Windows/WSL 可用性边界。
- Python smoke snapshot：3通过、1因 Windows symlink 创建权限跳过。
- `npm run build`、`npm run check:bundle`：退出0。
- `kb index`：退出0；项目 `kb check`：退出1，仅5个 SOURCE_CHANGED，保留原历史来源基线而未自动刷新 checked_at。不存在 schema/索引/关系错误。
- `--release --profile=continuity --change-class=core`：退出1，工程模型证据pending；历史QA证据与候选subject不匹配，未伪造复用。

开发中曾发生 Windows rename共享冲突（改为有界rename重试）、Git子进程超过5秒测试上限（针对相关测试设置15秒）、旧fixture schema修正误改错误语句（恢复原语义）、早期eval记录过期等；原始失败与修复记录保留在会话和 `.cache` 日志。测试断言没有为取得通过而放宽。

最终 CI 结果与最新命令退出值记录在 `validation.json`；本节逐层计数不替代最终CI收据。

## 离线 campaign

24 episodes × B5 × 1，fake CLI，真实子进程与Git patch转移；没有真实模型调用。全部24通过。逐次证据路径和hash见 `offline-results.json`；原始工作区、工具输出、检查脚本、补丁和manifest在根目录 `.cache/engineering-final-20260915/`。这是本地保留的可追溯原件，不属于分发Skill。

| Episode | 结果 | 会话数 | 全生命周期毫秒 |
|---|---|---:|---:|
| C01-A | pass | 2 | 9427 |
| C01-B | pass | 2 | 10467 |
| C02-A | pass | 1 | 5097 |
| C02-B | pass | 1 | 6529 |
| C03-A | pass | 1 | 5554 |
| C03-B | pass | 1 | 6480 |
| C04-A | pass | 2 | 6738 |
| C04-B | pass | 1 | 6687 |
| C05-A | pass | 1 | 6268 |
| C05-B | pass | 1 | 5927 |
| C06-A | pass | 3 | 11843 |
| C06-B | pass | 3 | 19435 |
| C07-A | pass | 2 | 11144 |
| C07-B | pass | 2 | 14002 |
| C08-A | pass | 2 | 12143 |
| C08-B | pass | 1 | 6452 |
| C09-A | pass | 1 | 5923 |
| C09-B | pass | 1 | 4491 |
| C10-A | pass | 1 | 4817 |
| C10-B | pass | 2 | 11249 |
| C11-A | pass | 2 | 9900 |
| C11-B | pass | 2 | 7930 |
| C12-A | pass | 1 | 3874 |
| C12-B | pass | 2 | 4518 |

全部尝试总耗时：196895 ms；每成功任务摊销：8203.96 ms。该数是本机离线驱动耗时，包含准备/执行/验证；Token、缓存用量、金额未测，双成功B4/B5配对效率差为空，不能推断模型收益。

L2：8对真实历史任务，3仓库；commit、ancestor、不同patch和指定revision许可证已验证。`qs-encoding-boundaries` experience 可导出既有external适配器。其余 followup 尚需各自回归适配才可实测；选出任务对不等于完成公开仓库任务成绩，也不把共享任务的pair当独立repo。

## 宿主与外部阻塞

| 项目 | 实测范围 | 未取得证据 |
|---|---|---|
| Windows Codex 0.152.1 | version/help | 自然发现/读取/工程影响/生命周期未测 |
| Windows OpenCode 1.18.30 | version/run help | 同上 |
| 1302-1 Codex 0.153.2 | 工程协作、源码测试、Linux进程 | developer execution恢复不证明benchmark OS隔离 |
| Claude Code / Cursor / Cline / Roo | 手动读取/桥接路径文档 | 当前任务无真实运行；保持not-tested/unavailable |

1302-1 wrapper分别报 loopback RTM_NEWADDR 与 uid-map permission denied，开发线程因此临时改用非bwrap执行，未改全局。正式模型runner不会把该环境标记为已隔离。需要可验证的sandbox/container或既有受控外部执行收据，以及明确model/endpoint/总预算，才能完成B0/B4/B5 8核心×3次与B1/B2/B3 controls。不同模型的跨宿主组合只能报告异构栈验证。未满足 required evidence 的 profile 保持不可发布。

## 可复制命令

```text
npm ci
npm run build
npm run ci
npm run eval:engineering:test
node maintainer/evals/engineering/campaign.mjs plan
node maintainer/evals/engineering/campaign.mjs offline .cache/new-campaign
node maintainer/evals/engineering/campaign.mjs report .cache/new-campaign
node maintainer/evals/engineering/l2.mjs plan
node maintainer/evals/engineering/l2.mjs export qs-encoding-boundaries experience .cache/new-l2-adapter
node skills/self-evolution/references/bin/kb.mjs write .agents/knowledge/guides/example.md proposal.md <expected-sha256-or-absent> --project-root .
node skills/self-evolution/references/bin/kb.mjs index --project-root .
node skills/self-evolution/references/bin/kb.mjs check --project-root .
node skills/self-evolution/references/bin/kb.mjs adapter remove <tool> --project-root .
node skills/self-evolution/references/bin/kb.mjs migrate rollback <run-id> --project-root .
```

保持现有2.x migration/rollback。工作区未提交改动回退应先保存当前diff/未跟踪文件并使用明确文件清单；不要对整个仓库执行reset/clean。冻结B4包可恢复分发物原字节，不能代替整个工程未提交补丁。

## 文件索引

- `../2026-09-continuity.md`：升级状态、设计/政策预声明与已知故障。
- `subjects.json`、`files.json`：实际字节摘要与变更清单。
- `offline-results.json`：24次结果及原始证据hash/路径。
- `../../evals/engineering/README.md`：驱动、六baseline、L2/L3与模型运行配置。
- `../../evals/engineering/POLICY.md`、`../../evals/SPEC.md`：发布政策。
- `../../evals/RESULTS.md`：当前发布结论；历史原件在 `../../evals/results/history/7b608e3/`。
