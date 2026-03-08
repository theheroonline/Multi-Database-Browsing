# Multi-Database Browsing / 多数据库浏览器（本地客户端）

**简短说明（中文）**：本项目是一个本地多数据库桌面客户端，目前包含 Elasticsearch、MySQL 与 Redis 三类连接能力。

**Short description (English)**: A local multi-database desktop client with Elasticsearch, MySQL, and Redis support.



---

## 功能 / Features ✅

- Elasticsearch / ES：数据浏览、条件过滤、分页查看、简易 SQL、REST 风格高级操作、索引管理
- MySQL / MySQL：库表浏览、表结构查看、SQL 执行
- Redis / Redis：连接管理、单下拉切换数据库、基于 SCAN 的分批 Key 浏览、常见类型详情查看、表格式新增/编辑、批量删除、TTL 数字倒计时修改、Redis Console

## Redis 当前实现 / Redis MVP

- 参考了 AnotherRedisDesktopManager 的核心交互思路：连接管理、DB 切换、SCAN 浏览、按 key type 查看内容、控制台执行命令。
- 当前版本重点仍然是浏览与诊断，但已经补上常见 Key 的表格式新增、编辑、批量删除和独立 TTL 修改能力。
- 支持 Redis 连接保存、复制、测试与切换。
- 支持读取 Redis 数据库列表与 key 数量概览，并通过单个下拉框切换 DB，避免和侧栏重复展示。
- 支持按 pattern 扫描 key，并按批次展示结果，避免在几十万 key 的库中一次渲染过多内容。
- 支持新增与编辑 string、hash、list、set、zset 五类常见 key，其中 hash、list、zset 采用表格式编辑，减少直接写 JSON 的成本。
- 支持对任意已选 key 独立修改 TTL，TTL 按钮实时显示数字倒计时；支持单个删除和批量删除，批量删除带二次输入确认。
- 支持 Redis Console 执行原始命令。
- 暂未实现 AnotherRedisDesktopManager 中较重的批量导入导出、订阅、慢日志、内存分析等能力。


## 本地化 / Localization 🌐

- 已支持中英两种语言（使用 `react-i18next`），请查看 `locales/en.json` 与 `locales/zh.json`。

## 快速开始 / Quick Start 💡

1. 安装依赖 / Install dependencies

```bash
npm install
```

2. 启动开发服务器 / Start dev server

```bash
npm run dev
```

> 注意 / Note: `npm run dev` 仅启动浏览器端页面。MySQL 与 Redis 功能依赖 Tauri 后端命令，需使用 `npm run tauri:dev` 才能连接与操作本地数据库。

3. 打包 / Build

```bash
npm run build
```

4. 使用 Tauri 打包（可选） / Tauri (optional)

```bash
npm run tauri:dev    # 开发
npm run tauri:build  # 发布
```

## 常用脚本 / Useful scripts 🔧

- `npm run dev` — 开发启动 / Start dev server
- `npm run build` — 构建生产包 / Build
- `npm run build:tauri` — 构建用于 Tauri 的产物
- `npm run tauri:dev` / `npm run tauri:build` — Tauri 开发 / 打包
- `npm run preview` — 预览构建结果
- `npm run lint` — 代码检查

---


**License**: 无

