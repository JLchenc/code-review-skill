import { z } from "zod";
import { createReactAgent, ToolNode } from "@langchain/langgraph/prebuilt";
import type {
  CodeReviewFinding,
  CodeReviewResult,
  CodeReviewSkillOptions,
  CodeReviewInput,
} from "./types.js";

const ReviewInputSchema = z.object({
  prNumber: z.number().optional().describe("PR 编号"),
  prUrl: z.string().url().optional().describe("PR / MR 链接"),
  diff: z.string().optional().describe("代码diff"),
  changedFiles: z.array(z.string()).optional().describe("变更的文件列表"),
  focus: z.enum(["security", "performance", "maintainability", "all"]).optional().default("all").describe("关注点"),
});


export class CodeReviewSkill {
  private model: CodeReviewSkillOptions["model"];
  private tools: CodeReviewSkillOptions["tools"];

  constructor(options: CodeReviewSkillOptions) {
    if (!options.model) {
      throw new Error("CodeReviewSkill 需要传入 model");
    }

    if (!Array.isArray(options.tools) || options.tools.length === 0) {
      throw new Error("CodeReviewSkill 需要传入 tools");
    }
    this.model = options.model;
    this.tools = options.tools;
  }

  async run(input: unknown): Promise<CodeReviewResult> {
    const parsed = ReviewInputSchema.safeParse(input);

    if (!parsed.success) {
      return this.fail("输入参数无效", parsed.error.message);
    }

    const { prNumber, prUrl, diff, changedFiles, focus } = parsed.data;

    if (!prUrl && !diff && (!changedFiles || changedFiles.length === 0)) {
      return this.fail(
        "缺少审查上下文",
        "请提供 prUrl、diff、changedFiles 或 prNumber 中的至少一项。"
      );
    }

    try {
      const agent = createReactAgent({
        llm: this.model,
        tools: new ToolNode(this.tools),
        prompt: this.buildSystemPrompt({
          prNumber,
          prUrl,
          diff,
          changedFiles,
          focus,
        }),
      });

      const result = await agent.invoke({
        messages: [
          {
            role: "user",
            content: this.buildUserPrompt({ prNumber, prUrl, focus }),
          },
        ],
      });

      const lastMessage = result.messages[result.messages.length - 1];
      const content = String(lastMessage.content ?? "");

      const findings = this.extractFindings(content);
      const hasCritical = findings.some((f) => f.severity === "CRITICAL");

      return {
        status: "success",
        summary: content,
        findings,
        hasCritical,
      };
    } catch (error: any) {
      return this.fail(
        "代码审查执行失败",
        error?.message ?? String(error)
      );
    }
  }

  private buildSystemPrompt(input: {
    prNumber?: number;
    prUrl?: string;
    diff?: string;
    changedFiles?: string[];
    focus: string;
  }): string {
    const contextLines: string[] = [];

    if (input.prNumber) {
      contextLines.push(`PR 编号：${input.prNumber}`);
    }

    if (input.prUrl) {
      contextLines.push(`PR 地址：${input.prUrl}`);
    }

    if (input.diff) {
      contextLines.push(`代码 diff：\n${input.diff}`);
    }

    if (input.changedFiles && input.changedFiles.length > 0) {
      contextLines.push(`变更文件：${input.changedFiles.join(", ")}`);
    }

    contextLines.push(`审查重点：${input.focus}`);

    const context = contextLines.filter(Boolean).join("\n");

    return `
你是代码审查助手。你的目标是辅助人工 reviewer 做第一轮风险扫描，而不是替代最终批准。

## 可用工具
你可以通过工具读取 PR diff、变更文件、CI 日志、测试报告或仓库文件。
如果上下文中已经提供了 diff 和文件列表，优先直接使用；如果信息不足，再通过工具补充。

## 审查流程
1. 确认本次变更范围，优先阅读 PR 描述和 diff。
2. 识别变更涉及的核心模块、公共接口、数据流和权限逻辑。
3. 按以下优先级审查：
   - 安全性：鉴权、注入、密钥泄露、越权、敏感数据。
   - 正确性：边界条件、空值、异常处理、并发、数据一致性。
   - 性能：循环、查询、缓存、内存、N+1。
   - 可维护性：命名、职责拆分、重复代码、配置硬编码。
   - 测试：关键路径是否有覆盖，变更是否影响现有测试。
4. 每个问题必须给出：文件、行号或代码片段、触发条件、影响范围、修复建议。
5. 不要纠结纯风格问题，除非项目已有明确规范。
6. 如果无法确认上下文，标记为 INFO，不要过度猜测。

## 输出格式
先输出一段简短总结（2-3 句话），再输出 JSON 数组：

\`\`\`json
[
  {
    "file": "src/api/order.ts",
    "line": 42,
    "severity": "CRITICAL",
    "category": "security",
    "description": "存在 SQL 注入风险",
    "suggestion": "使用参数化查询"
  }
]
\`\`\`

severity 只能是 CRITICAL、WARNING、INFO。
category 只能是 security、correctness、performance、maintainability、test、other。

## 当前审查上下文
${context}
`;
  }

  private buildUserPrompt(input: {
    prNumber?: number;
    prUrl?: string;
    focus: string;
  }): string {
    if (input.prNumber) {
      return `请审查 PR #${input.prNumber}，重点关注 ${input.focus}。`;
    }

    if (input.prUrl) {
      return `请审查这个 PR：${input.prUrl}，重点关注 ${input.focus}。`;
    }

    return `请审查当前代码变更，重点关注 ${input.focus}。`;
  }

  private extractFindings(content: string): CodeReviewFinding[] {
    const findings: CodeReviewFinding[] = [];
    const jsonBlocks = content.match(/```json\s*([\s\S]*?)```/g) ?? [];

    for (const block of jsonBlocks) {
      try {
        const raw = block.replace(/```json\s*|\s*```/g, "").trim();
        const parsed = JSON.parse(raw);
        const items = Array.isArray(parsed) ? parsed : [parsed];

        for (const item of items) {
          if (!item || typeof item !== "object") {
            continue;
          }

          const severity =
            item.severity === "CRITICAL" ||
              item.severity === "WARNING" ||
              item.severity === "INFO"
              ? item.severity
              : "INFO";

          const category = [
            "security",
            "correctness",
            "performance",
            "maintainability",
            "test",
            "other",
          ].includes(item.category)
            ? item.category
            : "other";

          const description = String(item.description ?? "").trim();

          if (!description) {
            continue;
          }

          const finding: CodeReviewFinding = {
            file: String(item.file ?? "unknown"),
            line:
              item.line != null && !Number.isNaN(Number(item.line))
                ? Number(item.line)
                : undefined,
            severity,
            category,
            description,
            suggestion: item.suggestion
              ? String(item.suggestion)
              : undefined,
          };

          findings.push(finding);
        }
      } catch {
        continue;
      }
    }

    return findings;
  }

  private fail(summary: string, error?: string): CodeReviewResult {
    return {
      status: "failed",
      summary,
      findings: [],
      hasCritical: false,
      error,
    };
  }
}
