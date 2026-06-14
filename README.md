# Zotero AI OCR

<p align="center">
  <img src="addon/content/icons/favicon.png" alt="AI OCR Logo" width="96" height="96">
</p>

<p align="center">
  <strong>AI OCR</strong> — 基于 AI 的 Zotero 文档 OCR 识别插件
</p>

<p align="center">
  <a href="https://github.com/4965898/Zotero-AI-OCR">GitHub</a> ·
  <a href="#安装">安装</a> ·
  <a href="#使用方法">使用方法</a> ·
  <a href="#配置说明">配置说明</a>
</p>

---

## 简介

**AI OCR** 是一款 Zotero 7 插件，支持调用 **PaddleOCR**、**MinerU** 和 **AI 视觉大模型**对 PDF 文档和图片进行 OCR 识别，并将识别结果以 Markdown 笔记的形式附加到 Zotero 条目中。

### 主要特性

- 🤖 **多引擎支持** — PaddleOCR + MinerU + 12+ AI 视觉大模型平台
- 🧠 **AI 视觉模型** — 支持 OpenAI、Gemini、DeepSeek、通义千问、智谱 GLM、Kimi、月之暗面、Groq、Mistral、浦源书生、小米 MiMo、NVIDIA NIM 等平台
- 🔧 **自定义引擎** — 支持添加任意 OpenAI 兼容或 Gemini 兼容的 API 端点，可保存多个自定义引擎
- 📄 **识别指定页面** — 支持输入页码范围（如 1-5, 8, 10-12）对 PDF 的指定页面进行 OCR，特别适合大型文档
- ✏️ **自定义提示词** — 可为 AI 视觉模型设置自定义 OCR 提示词，灵活适配不同识别场景
- 📝 **Markdown 笔记** — 识别结果自动生成 Zotero 笔记，支持自定义命名模板
- ⚡ **异步 API** — PaddleOCR 引擎全面支持异步调用模式
- 🖼️ **图片注释 OCR** — 支持对 PDF 区域截图注释进行 OCR，结果以评论形式附加到注释
- 🔄 **批量识别** — 支持同时选择多个条目进行批量 OCR
- 🔁 **自动 OCR** — 可选在添加新 PDF 附件时自动触发识别
- ⚙️ **高级功能** — 每个引擎提供独立的高级选项（公式识别、表格识别、OCR 开关等）
- 🔗 **多端点管理** — 支持为每个引擎配置多个 API 端点，可切换活跃端点
- 🌐 **中英双语** — 完整的中文和英文界面

## 安装

1. 从 [Releases](https://github.com/4965898/Zotero-AI-OCR/releases) 页面下载最新版本的 `.xpi` 文件
2. 打开 Zotero 7，进入 **工具 → 插件**
3. 点击右上角齿轮图标，选择 **Install Add-on From File**
4. 选择下载的 `.xpi` 文件，确认安装
5. 重启 Zotero

## 使用方法

### 基本识别

1. 在 Zotero 中选中一个或多个包含 PDF 附件的条目
2. 右键点击，选择 **AI OCR 识别**
3. 等待识别完成，结果将自动添加为该条目的笔记

### 批量识别

1. 选中多个条目
2. 右键点击，选择 **批量 AI OCR 识别**
3. 插件将依次处理所有 PDF 附件

### 识别指定页面

1. 选中一个包含 PDF 附件的条目
2. 右键点击，选择 **识别指定页面**
3. 在弹出的对话框中输入页码范围（如 `1-5, 8, 10-12`）
4. 插件将仅识别指定页面，结果合并为一个笔记附加到条目上

> 💡 此功能特别适合超大型 PDF，可只对需要的几页或某个章节进行 OCR。PaddleOCR 和 AI 视觉模型均支持此功能，MinerU 暂不支持。

### 图片注释 OCR

1. 在 PDF 阅读器中，使用「选择区域」工具框选 PDF 某一区域，创建图片注释
2. 在左侧边栏找到该图片注释，点击注释标题行末尾的 **OCR** 按钮
3. 等待识别完成，结果将以评论形式附加到该注释下方

> 💡 PaddleOCR 和 AI 视觉模型均支持此功能，MinerU 仅支持完整 PDF 文档，不支持图片注释识别。

### 切换引擎

- **方法一**：右键菜单 → **切换 OCR 引擎** → 选择目标引擎
- **方法二**：插件设置 → 顶部引擎下拉框

### 高级选项

右键菜单 → **OCR 高级选项** → 勾选/取消当前引擎支持的高级功能

## 配置说明

打开 **Zotero → 编辑 → 设置 → AI OCR** 进入插件设置。

### 通用设置

| 设置项       | 说明                                                    |
| ------------ | ------------------------------------------------------- |
| OCR 引擎     | 选择识别引擎（顶部全局选择）                            |
| API 模式     | PaddleOCR 引擎仅支持异步模式；MinerU 和 AI 引擎无需设置 |
| 笔记命名规则 | 默认 / Zotero 命名规则 / 自定义模板                     |
| 自动 OCR     | 新 PDF 附件添加时自动识别                               |
| 并发数       | 批量识别时的并发数（1-10）                              |

### AI 视觉模型配置

选择 AI 引擎后，在 **AI 视觉模型配置** 标签页中设置：

| 设置项       | 说明                                                                 |
| ------------ | -------------------------------------------------------------------- |
| API Key      | 对应平台的 API 密钥                                                  |
| 模型名称     | 可使用默认模型，也可填入该平台支持的其他视觉模型                     |
| API Base URL | 默认已预填，一般无需修改                                             |
| 自定义提示词 | 留空使用默认提示词，填写后所有 AI 视觉模型和自定义引擎均使用该提示词 |

> 💡 各平台的 API Key 获取方式见下方引擎详情。

### 自定义引擎

在 **自定义引擎** 标签页中，可添加任意 OpenAI 兼容或 Gemini 兼容的 API：

| 设置项       | 说明                                                                  |
| ------------ | --------------------------------------------------------------------- |
| 引擎名称     | 自定义显示名称                                                        |
| API 完整地址 | 完整的 API 端点地址，如 `https://api.example.com/v1/chat/completions` |
| API Key      | 认证密钥                                                              |
| 模型名称     | 如 `qwen-vl-plus`                                                     |
| 最大 Tokens  | 默认 4096                                                             |
| Temperature  | 默认 0.1                                                              |

> 💡 插件会根据 URL 自动识别 API 格式：包含 `generativelanguage.googleapis.com` 的地址使用 Gemini 格式，其他地址使用 OpenAI 兼容格式。

### API 端点管理

为 PaddleOCR / MinerU 引擎配置 API 端点：

**PaddleOCR 引擎：**

- URL：`https://paddleocr.aistudio-app.com`
- Token：在 [AI Studio](https://aistudio.baidu.com/) 获取的 API Token

**MinerU 引擎：**

- URL：`https://mineru.net`
- Token：在 [MinerU 官网](https://mineru.net/apiManage/docs) 申请的 Bearer Token

> 💡 URL 只需填写域名部分，插件会自动拼接 API 路径。

### 自定义命名模板

选择"自定义"命名规则后，可使用以下变量：

| 变量                    | 说明                 |
| ----------------------- | -------------------- |
| `{{ firstCreator }}`    | 第一作者             |
| `{{ authors }}`         | 所有作者（逗号分隔） |
| `{{ year }}`            | 出版年份             |
| `{{ title }}`           | 文献标题             |
| `{{ itemType }}`        | 条目类型             |
| `{{ attachmentTitle }}` | 附件标题             |

**参数修饰符**（支持单引号和双引号）：

| 参数       | 说明                     | 示例                                             |
| ---------- | ------------------------ | ------------------------------------------------ |
| `suffix`   | 添加后缀                 | `{{ year suffix=' - ' }}`                        |
| `prefix`   | 添加前缀                 | `{{ year prefix='(' }}`                          |
| `max`      | 最大数量（用于 authors） | `{{ authors max='1' suffix=' et al.' }}`         |
| `truncate` | 截断长度                 | `{{ title truncate='50' }}`                      |
| `case`     | 大小写转换               | `case='upper'` / `case='lower'` / `case='title'` |

**示例模板：**

```
{{ firstCreator suffix=' - ' }}{{ year suffix=' - ' }}OCR Result
{{ authors max='1' suffix='_' }}{{ year }}_{{ title truncate='30' }}
```

## 引擎详情

### AI 视觉模型引擎

插件支持以下 AI 平台的视觉大模型，将 PDF 逐页渲染为图片后发送给模型进行 OCR：

| 引擎       | 平台       | 默认模型                                        | API Key 获取                                    |
| ---------- | ---------- | ----------------------------------------------- | ----------------------------------------------- |
| OpenAI     | OpenAI     | `gpt-4o`                                        | [平台设置](https://platform.openai.com/)        |
| Gemini     | Google     | `gemini-2.5-flash`                              | [AI Studio](https://aistudio.google.com/)       |
| DeepSeek   | DeepSeek   | `deepseek-chat`                                 | [开放平台](https://platform.deepseek.com/)      |
| 通义千问   | 阿里云     | `qwen-vl-max`                                   | [百炼平台](https://bailian.console.aliyun.com/) |
| 智谱 GLM   | 智谱 AI    | `glm-4v-flash`                                  | [开放平台](https://open.bigmodel.cn/)           |
| Kimi       | 月之暗面   | `moonshot-v1-auto`                              | [开放平台](https://platform.moonshot.cn/)       |
| Ollama     | 本地部署   | `qwen2.5vl:7b`                                  | 无需 Key                                        |
| OpenRouter | OpenRouter | `qwen/qwen3-vl-235b-a22b-instruct:free`         | [平台设置](https://openrouter.ai/)              |
| Groq       | Groq       | `meta-llama/llama-4-maverick-17b-128e-instruct` | [控制台](https://console.groq.com/)             |
| Mistral AI | Mistral    | `mistral-ocr-latest`                            | [平台设置](https://console.mistral.ai/)         |
| 浦源书生   | 浦源       | `internvl3.5-241b-a28b`                         | [开放平台](https://chat.intern-ai.org.cn/)      |
| 小米 MiMo  | 小米       | `mimo-v2.5`                                     | [开放平台](https://xiaomimimo.com/)             |
| NVIDIA NIM | NVIDIA     | `moonshotai/kimi-k2.6`                          | [NIM 平台](https://build.nvidia.com/)           |

> 💡 AI 视觉模型引擎不支持原生 PDF 输入，插件会自动将 PDF 逐页渲染为图片后发送。你也可以在模型名称中填入该平台支持的其他视觉模型。

### PaddleOCR 引擎

| 引擎             | 说明             | API 模式 | 高级功能                                                                         |
| ---------------- | ---------------- | -------- | -------------------------------------------------------------------------------- |
| PP-OCRv6         | 基础文字识别（最新） | 异步     | 方向矫正、扭曲矫正、文本行方向                                                   |
| PP-OCRv5         | 基础文字识别（旧版） | 异步     | 方向矫正、扭曲矫正、文本行方向                                                   |
| PP-StructureV3   | 文档结构解析     | 异步     | 方向矫正、扭曲矫正、文本行方向、图表识别、印章识别、表格识别、公式识别、版面分析 |
| PaddleOCR-VL-1.6 | 增强视觉语言模型 | 异步     | 方向矫正、扭曲矫正、图表识别                                                     |

### MinerU 引擎

| 引擎            | 说明                 | 高级功能                     |
| --------------- | -------------------- | ---------------------------- |
| MinerU-pipeline | 文档解析（默认模型） | OCR 识别、公式识别、表格识别 |
| MinerU-vlm      | 文档解析（推荐模型） | OCR 识别、公式识别、表格识别 |
| MinerU-HTML     | HTML 文档解析        | 无                           |

> MinerU 引擎仅支持异步 API，文件大小限制 200MB，页数限制 200 页。

## 项目结构

```
src/
├── index.ts                    # 入口文件
├── addon.ts                    # 插件类定义
├── hooks.ts                    # 生命周期钩子
├── utils/
│   ├── prefs.ts                # 偏好设置工具（含自定义引擎管理）
│   ├── locale.ts               # 本地化工具
│   └── ztoolkit.ts             # ZToolkit 创建
└── modules/
    ├── ocr-engine.ts           # OCR 引擎核心逻辑（AI 平台配置与调用）
    ├── context-menu.ts         # 右键菜单与 OCR 处理
    ├── annotation-ocr.ts       # 图片注释 OCR（侧边栏按钮）
    ├── auto-ocr.ts             # 自动 OCR 功能
    └── preferenceScript.ts     # 偏好设置面板逻辑（含自定义引擎管理）

addon/
├── manifest.json               # WebExtension 清单
├── prefs.js                    # 默认偏好设置
├── content/
│   ├── preferences.xhtml       # 设置面板 UI
│   ├── zoteroPane.css          # 样式
│   └── icons/                  # 图标
└── locale/
    ├── zh-CN/                  # 中文本地化
    └── en-US/                  # 英文本地化
```

## 更新日志

### v1.9.0

- 🆕 **PP-OCRv6 支持** — 新增百度 PaddleOCR 最新 PP-OCRv6 模型，作为默认引擎
- 🔄 PP-OCRv5 保留可用，标记为旧版引擎
- 📈 PP-OCRv6 相比 v5 提供更高精度和更广泛的语言支持

### v1.8.0

- 🖼️ **图片注释 OCR** — 新增对 PDF 区域截图注释的 OCR 功能
  - 在 PDF 阅读器左侧边栏的图片注释标题行末尾显示 OCR 按钮
  - 点击按钮即可对截图注释进行 OCR 识别
  - 识别结果以评论形式附加到注释下方
  - 支持 PaddleOCR 和所有 AI 视觉模型引擎（MinerU 不支持单张图片识别）

### v1.7.0

- ⚡ PaddleOCR 全面适配异步 API，移除同步模式
- 🔄 升级 VL-1.5 至 VL-1.6
- 🐛 修复页面范围 OCR 的 PDF 渲染问题

### v1.6.0

- 📄 新增识别指定页面功能 — 支持输入页码范围（如 1-5, 8, 10-12）
- ✏️ 新增自定义提示词 — 可为 AI 视觉模型设置自定义 OCR 提示词
- 🔄 更新多个引擎的默认模型

### v1.5.0

- 🤖 初始公开版本
- 🧠 支持 PaddleOCR、MinerU 和 12+ AI 视觉大模型平台
- 🔧 支持自定义引擎（OpenAI 兼容 / Gemini 兼容）
- 🔄 支持批量识别和自动 OCR
- ⚙️ 支持高级选项（公式识别、表格识别等）
- 🌐 中英双语界面

## 开发

### 环境要求

- Node.js >= 18
- npm >= 9
- Zotero 7

### 构建与调试

```bash
# 安装依赖
npm install

# 开发模式（自动重载）
npm start

# 构建 XPI
npm run build

# 代码检查
npm run lint:check

# 自动修复
npm run lint:fix
```

构建产物位于 `.scaffold/build/` 目录。

## 致谢

- [PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR) — 百度飞桨 OCR 引擎
- [MinerU](https://github.com/opendatalab/MinerU) — 开源文档解析引擎
- [zotero-plugin-template](https://github.com/windingwind/zotero-plugin-template) — Zotero 插件开发模板
- [zotero-plugin-toolkit](https://github.com/windingwind/zotero-plugin-toolkit) — Zotero 插件开发工具库

## 许可证

[AGPL-3.0-or-later](LICENSE)

## 赞助

如果你觉得本插件不错，可以请我喝杯咖啡 ☕

<p align="center">
  <img src="doc/images/alipay.jpg" alt="支付宝" width="200">
</p>

---

<p align="center">
  Developed by <a href="https://github.com/4965898">Daxoel</a> · <a href="https://github.com/4965898/Zotero-AI-OCR">GitHub</a>
</p>
