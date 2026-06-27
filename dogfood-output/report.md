# Dogfood Report: Claude.Web (Free Code)

| Field | Value |
|-------|-------|
| **Date** | 2026-06-27 |
| **App URL** | https://claudeweb-production-9853.up.railway.app/ |
| **Session** | claudeweb-production |
| **Scope** | Full app — core messaging flow, UI, settings, sidebar |

## Summary

| Severity | Count |
|----------|-------|
| Critical | 1 |
| High | 0 |
| Medium | 0 |
| Low | 3 |
| **Total** | **4** |

## Issues

### ISSUE-001: AI 回复完成后 UI 一直卡在"发送中..."状态

| Field | Value |
|-------|-------|
| **Severity** | critical |
| **Category** | functional |
| **URL** | https://claudeweb-production-9853.up.railway.app/ |
| **Repro Video** | N/A |

**Description**

发送消息后，AI 回复内容已完整显示在界面上，但输入框的"发送"按钮一直显示"发送中..."且禁用，60 秒后触发超时显示"响应超时，请重试"，然后才恢复正常。

**Root Cause**

服务端进程完成时发送的是 `{ type: 'exit', code }`，但客户端 `handleServerMessage` 只处理 `type: 'done'` 来复位 `isWaiting` 状态。服务端从未发送 `type: 'done'`，导致 `isWaiting` 永远不恢复。

**Fix (已推送部署)**

- 服务端: `proc.on('close')` 中额外发送 `{ type: 'done' }`
- 客户端: `handleServerMessage` 增加 `case 'exit':` 来兼容处理

**Screenshots**

1. 消息已收到，但按钮仍显示"发送中..."
   ![发送中卡死](screenshots/issue-001-sending.png)

---

### ISSUE-002: 部分 UI 元素切换英文后仍显示中文

| Field | Value |
|-------|-------|
| **Severity** | low |
| **Category** | content / ux |
| **URL** | https://claudeweb-production-9853.up.railway.app/ |
| **Repro Video** | N/A |

**Description**

切换语言到 English 后，以下元素仍显示中文：
- 消息按钮： "复制"、"编辑"、"重试"、"有帮助"、"需要改进"
- 输入框占位符： "消息输入框"
- 面板调整手柄： "调整面板大小"
- 会话标题： "新对话"
- 搜索结果显示： "搜索"、"找到 1 个"
- 工具栏按钮 description 属性： "选择语言"（语言按钮）、"切换主题"（主题按钮）

**Expected**

所有面向用户的文字应跟随当前语言设置切换为英文。

**Screenshots**

English 模式下仍可见中文元素：
![i18n 问题](screenshots/issue-002-i18n.png)

---

### ISSUE-003: Console 无障碍警告 — form field 缺少 id/name 属性

| Field | Value |
|-------|-------|
| **Severity** | low |
| **Category** | console / accessibility |
| **URL** | https://claudeweb-production-9853.up.railway.app/ |
| **Repro Video** | N/A |

**Description**

浏览器控制台持续输出 `[issue] A form field element should have an id or name attribute` 警告（计数 2 次）。页面中至少有一个表单字段缺少 id 或 name 属性。

**Expected**

所有表单元素应有 `id` 或 `name` 属性以符合无障碍标准。

**Console Evidence**

```
[issue] A form field element should have an id or name attribute (count: 2)
```

---

### ISSUE-004: 搜索激活时控制台输出 Autofocus 警告

| Field | Value |
|-------|-------|
| **Severity** | low |
| **Category** | console |
| **URL** | https://claudeweb-production-9853.up.railway.app/ |
| **Repro Video** | N/A |

**Description**

在搜索框中输入内容时，控制台输出 `Autofocus processing was blocked because a document already has a focused element`。

**Expected**

不应有 autofocus 冲突警告。可能是有多个元素同时设置了 autofocus，或者焦点管理逻辑需要优化。

**Console Evidence**

```
[info] Autofocus processing was blocked because a document already has a focused element. (0 args)
```

---
