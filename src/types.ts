export type FindingSeverity = "CRITICAL" | "WARNING" | "INFO";

export type FindingCategory =

  | "security"
  | "correctness"
  | "performance"
  | "maintainability"
  | "test"
  | "other";

export interface CodeReviewFinding {
  file: string;
  line?: number;
  severity: FindingSeverity;
  category: FindingCategory;
  description: string;
  suggestion?: string;
}

export interface CodeReviewResult {
  status: "success" | "failed";
  summary: string;
  findings: CodeReviewFinding[];
  hasCritical: boolean;
  error?: string;
}

export interface CodeReviewSkillOptions {
  model: any;
  tools: any[];
}

export interface CodeReviewInput {
  prNumber?: number;
  prUrl?: string;
  diff?: string;
  changedFiles?: string[];
  focus?: "security" | "performance" | "maintainability" | "all";
}
