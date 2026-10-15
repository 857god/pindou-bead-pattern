# 色卡数据放这里（可选）

开源仓库**不含任何品牌色卡数据**，只带合成色卡（`src/algorithm/palettes.mjs`）。
想用真实品牌色卡（Mard 221、Artkal 等）有两种方式：

## 方式一：外部数据目录（推荐，`npm run dev` 时生效）

准备一个符合 [pindou-color-data](https://github.com/HansBug/pindou-color-data) 约定的目录：

```
色卡根目录/
├── manifest.json
└── mard-221-alfonse-doudou/
    └── colors.json        # [{ "code": "A1", "hex": "#FAF5CD", ... }]
```

然后任选一种方式让开发服务器找到它：

```bash
# 或把目录放到仓库同级：../pindou-color-data
PINDOU_COLOR_DATA_ROOT=/绝对/路径/到/色卡根目录 npm run dev
```

开发服务器会把数据挂在 `/palettes/index.json` 与 `/palettes/<id>.json` 下，
前端不再区分来源。

## 方式二：直接放静态文件（生产构建也生效）

在本目录放两个文件，字段与开发服务器一致：

```json
// index.json
{ "palettes": [ { "id": "mard-221", "label": "Mard 221", "brand": "Mard", "paletteCode": "Mard-221", "colorCount": 221, "kind": "external" } ] }
```

```json
// mard-221.json
{ "id": "mard-221", "label": "Mard 221", "colors": [ { "code": "A1", "hex": "#FAF5CD" } ] }
```

`*.json` 已被 `.gitignore` 排除，不会被误提交。
