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

**AI OCR** 是一款 Zotero 7 插件，支持调用 **PaddleOCR** 和 **MinerU** 在线 AI 引擎对 PDF 文档进行 OCR 识别，并将识别结果以 Markdown 笔记的形式附加到 Zotero 条目中。

### 主要特性

- 🤖 **多引擎支持** — PaddleOCR（PP-OCRv5 / PP-StructureV3 / PaddleOCR-VL / PaddleOCR-VL-1.5）+ MinerU（pipeline / vlm / MinerU-HTML）
- 📝 **Markdown 笔记** — 识别结果自动生成 Zotero 笔记，支持自定义命名模板
- ⚡ **同步/异步 API** — PaddleOCR 支持同步和异步两种调用模式
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

### 切换引擎

- **方法一**：右键菜单 → **切换 OCR 引擎** → 选择目标引擎
- **方法二**：插件设置 → 顶部引擎下拉框

### 高级选项

右键菜单 → **OCR 高级选项** → 勾选/取消当前引擎支持的高级功能

## 配置说明

打开 **Zotero → 编辑 → 设置 → AI OCR** 进入插件设置。

### 通用设置

| 设置项       | 说明                                                     |
| ------------ | -------------------------------------------------------- |
| OCR 引擎     | 选择识别引擎（顶部全局选择）                             |
| API 模式     | PaddleOCR 引擎可选同步/异步；MinerU 引擎自动使用异步模式 |
| 笔记命名规则 | 默认 / Zotero 命名规则 / 自定义模板                      |
| 自动 OCR     | 新 PDF 附件添加时自动识别                                |
| 并发数       | 批量识别时的并发数（1-10）                               |

### API 端点管理

为当前选中的引擎配置 API 端点：

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

### PaddleOCR 引擎

| 引擎             | 说明             | API 模式    | 高级功能                                                     |
| ---------------- | ---------------- | ----------- | ------------------------------------------------------------ |
| PP-OCRv5         | 基础文字识别     | 同步 + 异步 | 方向矫正、扭曲矫正、文本行方向                               |
| PP-StructureV3   | 文档结构解析     | 同步 + 异步 | 方向矫正、扭曲矫正、文本行方向、图表识别、印章识别、表格识别、公式识别、版面分析 |
| PaddleOCR-VL     | 视觉语言模型     | 同步 + 异步 | 方向矫正、扭曲矫正、版面分析、图表识别                       |
| PaddleOCR-VL-1.5 | 增强视觉语言模型 | 同步 + 异步 | 方向矫正、扭曲矫正、图表识别                                 |

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
│   ├── prefs.ts                # 偏好设置工具
│   ├── locale.ts               # 本地化工具
│   └── ztoolkit.ts             # ZToolkit 创建
└── modules/
    ├── ocr-engine.ts           # OCR 引擎核心逻辑
    ├── context-menu.ts         # 右键菜单与 OCR 处理
    ├── auto-ocr.ts             # 自动 OCR 功能
    └── preferenceScript.ts     # 偏好设置面板逻辑

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

---

<p align="center">
  Developed by <a href="https://github.com/4965898">Daxoel</a> · <a href="https://github.com/4965898/Zotero-AI-OCR">GitHub</a>
</p>

