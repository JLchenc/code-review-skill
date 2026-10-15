# @jlchenc/code-review-skill

可复用的代码审查 Skill，基于 LangGraph 构建，支持结构化输出和风险分级。

## 功能特性

- **风险分级**：将问题标记为 CRITICAL（阻断）、WARNING（建议修改）、INFO（提示）
- **多维度扫描**：覆盖安全性、正确性、性能、可维护性、测试覆盖
- **结构化输出**：输出包含文件路径、行号、问题描述和修复建议的 JSON 数组
- **上下文感知**：优先使用用户提供的 diff/PR 信息，不足时主动调用工具获取

## 安装

```bash
npm install @jlchenc/code-review-skill
```

## 使用

```typescript
import { CodeReviewSkill } from "@jlchenc/code-review-skill";
import { ChatOpenAI } from "@langchain/openai";
import { tool } from "@langchain/core/tools";
import { z } from "zod";

// 定义工具
const getPrDiff = tool(
  async ({ prNumber }) => {
    // 实现获取 PR diff 的逻辑
    return { diff: "..." };
  },
  {
    name: "get_pr_diff",
    description: "获取 PR 的 diff 内容",
    schema: z.object({
      prNumber: z.number().describe("PR 编号"),
    }),
  }
);

// 初始化 Skill
const reviewSkill = new CodeReviewSkill({
  model: new ChatOpenAI({ model: "gpt-4o" }),
  tools: [getPrDiff],
});

// 执行审查
const result = await reviewSkill.run({
  prNumber: 123,
  focus: "security",
});

console.log(result.findings);
```

## API

### `CodeReviewSkill`

#### 构造函数

```typescript
new CodeReviewSkill(options: CodeReviewSkillOptions)
```

**参数：**
- `options.model` - LangChain 语言模型实例
- `options.tools` - LangChain 工具数组

#### `run(input: CodeReviewInput): Promise<CodeReviewResult>`

执行代码审查。

**输入参数：**
- `prNumber?: number` - PR 编号
- `prUrl?: string` - PR/MR 链接
- `diff?: string` - 代码 diff 内容
- `changedFiles?: string[]` - 变更文件列表
- `focus?: "security" | "performance" | "maintainability" | "all"` - 审查重点

**返回结果：**
- `status: "success" | "failed"` - 执行状态
- `summary: string` - 审查摘要
- `findings: CodeReviewFinding[]` - 发现的问题列表
- `hasCritical: boolean` - 是否存在严重问题
- `error?: string` - 错误信息（失败时）

### `CodeReviewFinding`

```typescript
interface CodeReviewFinding {
  file: string;           // 文件路径
  line?: number;          // 行号
  severity: "CRITICAL" | "WARNING" | "INFO";
  category: "security" | "correctness" | "performance" | "maintainability" | "test" | "other";
  description: string;    // 问题描述
  suggestion?: string;    // 修复建议
}
```

## 许可证

MIT
