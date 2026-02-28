# Multi-Database Browsing / 多数据库浏览器（本地客户端） 🚀

**简短说明（中文）**：本项目是一个轻量级的本地 Elasticsearch 浏览客户端。

**Short description (English)**: A lightweight local Elasticsearch browsing client.

<img width="1318" height="839" alt="1fa5a634-2766-4d40-9275-5f63be500838" src="https://github.com/user-attachments/assets/8163aa63-4134-45df-a3b3-dd45d05d61f5" />


---

## 功能 / Features ✅

- 数据浏览 / Data Browser：条件过滤、分页、结果查看
- 简易 SQL / Simple SQL：SQL 生成器、执行查询、历史记录
- 高级操作 / Advanced: Restful风格操作,支持单个和批量操作
- 索引管理 / Index Management：查看、创建、删除、刷新、索引详情
- 连接配置 / Connections：多连接管理、连接测试、支持带凭据的 Base URL

## 兼容性 / Compatibility ⚠️

- Elasticsearch 7.1+

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

