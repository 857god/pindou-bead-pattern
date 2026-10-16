# 贡献指南

这个仓库刻意只做两件事：**像素化处理**（降采样）与**色号匹配**。改动之前请先读
[README](README.md) 的「两步在做什么」与「与原页面的差异」。

## 开发环境

```bash
npm install
npm run dev        # http://127.0.0.1:5310
npm test           # node --test：不需要网络，也不需要品牌色卡数据
npm run build
```

不需要任何后端或密钥。没有品牌色卡数据时，界面会自动退回 4 档内置合成色卡，
所以 clone 下来就能跑，也能在 CI 里完整跑测试。

浏览器里还有两个自检入口：

- `?autotest=1` —— 自动跑完两步，把实测数字写进页面上的 `<pre id="autotest">`
- `?testdrive=1` —— 逐个点控件并断言「结果真的重算了」，用来抓假控件

## 代码结构

| 路径 | 作用 |
| --- | --- |
| `src/algorithm/chain.mjs` | 成像主链。**从 App 页面机械抽取**而来（见 README「算法来源与验证」），改动请格外小心 |
| `src/algorithm/stages.mjs` | 两步的入口：`runStructureStage` / `runMatchStage` |
| `src/workflow.mjs` | 两步的状态机、控件与重算规则 |
| `src/components/` | 界面组件 |
| `test/`、`scripts/smoke.mjs` | 测试与端到端冒烟 |

## 硬性约定

1. **不要提交品牌色卡数据。** `public/palettes/*.json` 已被 `.gitignore` 排除；真实色卡通过
   `PINDOU_COLOR_DATA_ROOT` 指向外部目录（见 [`public/palettes/README.md`](public/palettes/README.md)）。
   带色卡数据的 PR 会被直接关掉——那是别人整理的数据，授权不在本仓库。
2. 不要提交 `dist/`、`node_modules/` 或任何构建产物。
3. **改算法必须给证据。** PR 里请写清：
   - `npm test` 与 `node scripts/smoke.mjs 96` 的实测数字（色数 / 平均 ΔE00 / 孤立豆）；
   - 这次改动**是否改变输出**。如果改变了，贴上前后对比，并说明为什么值得改。
   注意 `*ElapsedMs` 这类耗时数字随机器波动，不要用它当"更快了"的证据。
4. **不要随手调「标准档位取值表」**（`getStandardBaseline` / `getStandardMatchBaseline` /
   `getBlockUnityParams`）。它决定默认效果，是这套算法调出来的结果，不是可以随意试的参数。
5. **界面文案保持与 App 原页面一致**（例如「孤色清理」「肤色自然」「块面统一」）。
   不要为了"更好懂"改词——两边文案不一致会让人以为是两个不同的功能。
6. 提交信息用中文，格式 `type(scope): description`，例如
   `fix(match): 修掉色卡缓存命中错误`。`type` 用 `feat` / `fix` / `refactor` / `docs` / `test` / `chore`。
7. 不要引入运行时依赖（目前只有 Vue 一个）。算法部分不允许依赖 DOM 或 `uni.*`——
   它要能在 Node 里直接跑，这是 `npm test` 与 `scripts/smoke.mjs` 的前提。

## PR

- 一个 PR 只做一件事，说明动机、做法和验证方式。
- 不接受把两步合并、或加入导出 / 编辑器 / AI 生成这类功能：本仓库刻意只保留两步，
  完整功能在 App 里。
