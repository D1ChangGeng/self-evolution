export type OutputFormat = "text" | "json";

export type SourceBaseline = {
  path: string;
  checked_at: string;
};

export type GuideFrontmatter = {
  kind: "guide" | "runbook" | "map" | "policy";
  status: "draft" | "active" | "superseded" | "retired";
  scope: string[];
  use_when: string[];
  review_when?: string[];
  sources?: SourceBaseline[];
};

export type DecisionFrontmatter = {
  kind: "decision";
  id: string;
  status: "proposed" | "accepted" | "superseded" | "rejected";
  date: string;
  scope: string[];
  supersedes: string | string[] | null;
  sources?: SourceBaseline[];
};

export type IndexDocument = {
  path: string;
  kind: GuideFrontmatter["kind"] | "decision";
  status: string;
  scope: string[];
  use_when?: string[];
  id?: string;
  date?: string;
};

export type Diagnostic = {
  code: string;
  severity: "error" | "warning" | "info";
  message: string;
  path?: string;
};

export type CommandResult = {
  command: string;
  ok: boolean;
  exitCode?: 1 | 2 | 3;
  changed?: boolean;
  diagnostics?: Diagnostic[];
  data?: unknown;
};

export class KbError extends Error {
  constructor(
    message: string,
    readonly exitCode: 2 | 3,
    readonly code: string,
  ) {
    super(message);
  }
}
