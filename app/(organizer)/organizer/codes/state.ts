import type { ColumnUse, CodeKind, CodePlan } from "@/lib/csv/codes-import";

export type CodePreviewRow = {
  line: number;
  code: string;
  /** Workshop: the join URL. Kiro: the redemption URL. */
  link: string | null;
  /** Workshop: AWS team name and account. Kiro: amount and expiry. */
  info: string;
};

export type CodeImportState = {
  error: string | null;
  headers: string[];
  kind: CodeKind | null;
  columns: ColumnUse[];
  total: number;
  sample: CodePreviewRow[];
  warnings: string[];
  plan: CodePlan | null;
  /** After importing. */
  done: string | null;
};

export const emptyCodeImportState: CodeImportState = {
  error: null,
  headers: [],
  kind: null,
  columns: [],
  total: 0,
  sample: [],
  warnings: [],
  plan: null,
  done: null,
};
