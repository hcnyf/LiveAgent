// Thin, fully-typed invoke bindings over the Rust MemoryStore commands.
// On the gateway web build the same file works unchanged: the Tauri `invoke`
// shim intercepts every `memory_*` command and forwards it over the websocket
// to the connected desktop agent.

import { invoke } from "@liveagent/app/shims/tauriCore";
import { notifyMemoryChanged } from "./changes";
import type {
  ApplyDecision,
  MemoryConfidence,
  MemoryEvidenceFields,
  MemoryScope,
  MemoryScopeFilter,
  MemorySearchType,
  MemoryType,
  MemoryUpdateMode,
  OrganizerMode,
  OrganizerScope,
} from "./schema";

export type MemoryHistoryTimeMode = "message" | "updated" | "conversation";

export type MemoryMeta = {
  slug: string;
  scope: MemoryScope;
  workdirHash: string;
  workdirPath?: string | null;
  memoryType: MemorySearchType;
  description: string;
  headline: string;
  dateLocal?: string | null;
  createdAt: number;
  updatedAt: number;
  appendCount: number;
  archived: boolean;
  unreviewed: boolean;
  confidence: MemoryConfidence;
  fileSize: number;
};

export type MemoryScopeQuota = {
  scope: MemoryScope;
  workdirHash: string;
  used: number;
  limit: number;
};

export type MemoryListResponse = {
  entries: MemoryMeta[];
  truncated: boolean;
  quota: {
    used: number;
    limit: number;
    scopeQuotas?: MemoryScopeQuota[];
  };
};

export type MemoryReadResponse = {
  slug: string;
  scope: MemoryScope;
  memoryType: MemorySearchType;
  description: string;
  headline: string;
  body: string;
  totalLines: number;
  window: {
    offset: number;
    length: number;
    truncated: boolean;
  };
  meta: {
    unreviewed: boolean;
    confidence: MemoryConfidence;
    source: unknown;
    createdAt: number;
    updatedAt: number;
    archived: boolean;
  };
};

export type MemorySearchMatch = {
  slug: string;
  scope: MemoryScope;
  memoryType: MemorySearchType;
  description: string;
  headline: string;
  snippet: string;
  score: number;
  rawScore?: number | null;
  ageDays?: number | null;
  unreviewed: boolean;
  confidence: MemoryConfidence;
};

export type MemoryHistorySearchMatch = {
  source: "message" | "segment" | string;
  conversationId: string;
  title: string;
  cwd?: string | null;
  segmentIndex: number;
  segmentId: string;
  messageIndex?: number | null;
  messageId?: string | null;
  role?: string | null;
  snippet: string;
  score: number;
  rawScore?: number | null;
  updatedAt: number;
};

export type MemorySearchResponse = {
  matches: MemorySearchMatch[];
  historyMatches: MemoryHistorySearchMatch[];
  usedFallback: boolean;
};

export type MemoryMutationResponse = {
  slug: string;
  scope: MemoryScope;
  created: boolean;
  updated: boolean;
  deleted: boolean;
  indexUpdated: boolean;
  warning?: string | null;
  /** Confidence actually stored after the Rust-side contract ran. */
  appliedConfidence?: MemoryConfidence | null;
  autoDowngraded?: boolean | null;
};

export type MemoryDeleteProjectResponse = {
  workdirHash: string;
  deletedCount: number;
  quarantinePath?: string | null;
};

export type MemoryOverviewEntry = {
  slug: string;
  scope: MemoryScope;
  memoryType: MemorySearchType;
  description: string;
  headline: string;
  dateLocal?: string | null;
  updatedAt: number;
  unreviewed: boolean;
  confidence: MemoryConfidence;
};

export type MemoryOverviewResponse = {
  user: MemoryOverviewEntry[];
  project: MemoryOverviewEntry[];
  global: MemoryOverviewEntry[];
  recentDays: MemoryOverviewEntry[];
  root: string;
  workdirHash?: string | null;
};

export type MemoryPathsInfo = {
  root: string;
  isFresh: boolean;
  isInCloud: boolean;
  cloudProvider?: string | null;
};

export type MemoryRejectionEntry = {
  slug: string;
  scope: string;
  workdirHash: string;
  rejectedAt: number;
  actor: string;
  reason?: string | null;
};

export type MemoryRecentRejectionsResponse = {
  entries: MemoryRejectionEntry[];
};

export type MemoryQuotaScopeSummary = {
  scope: MemoryScope;
  workdirHash: string;
  used: number;
  limit: number;
  headroom: number;
  archivedCount: number;
  unreviewedCount: number;
  oldestUnreviewedAgeDays?: number | null;
};

export type MemoryQuotaSummaryResponse = {
  scopes: MemoryQuotaScopeSummary[];
};

export type MemoryBatchResponse = {
  created: string[];
  updated: string[];
  deleted: string[];
  warnings: string[];
  warningDetails?: MemoryBatchWarning[];
};

export type MemoryBatchWarning = {
  code: string;
  message: string;
  slug?: string | null;
  op?: string | null;
  groupId?: string | null;
  decisionIndex?: number | null;
  details?: unknown;
};

export type MemoryOrganizeRunStatus =
  | "pending"
  | "running"
  | "succeeded"
  | "failed"
  | "skipped"
  | "cancelled";

export type MemoryOrganizeTrigger = "manual" | "scheduled";

export type MemoryOrganizeRun = {
  runId: string;
  trigger: MemoryOrganizeTrigger;
  status: MemoryOrganizeRunStatus;
  createdAt: number;
  startedAt?: number | null;
  finishedAt?: number | null;
  dueAt?: number | null;
  claimedAt?: number | null;
  model: unknown;
  scope: string;
  mode: string;
  inputCount: number;
  clusterCount: number;
  safeApplied: number;
  reviewSkipped: number;
  createdCount: number;
  updatedCount: number;
  deletedCount: number;
  mergedCount: number;
  parseFailures: number;
  error?: string | null;
  finalSummary?: string | null;
  phase?: string | null;
  finalCount: number;
  compressionRatio?: number | null;
  compressionTarget?: number | null;
  dryRun: boolean;
  tokenUsageTotal: number;
  quotaHeadroomAtStart?: number | null;
  overrideReviewed: boolean;
  /** Typed run report; parse only via organizer/runRecord.ts. */
  report: unknown;
};

export type MemoryOrganizeRunCreateResponse = {
  run?: MemoryOrganizeRun | null;
  accepted: boolean;
  alreadyRunning: boolean;
  activeRun?: MemoryOrganizeRun | null;
};

export type MemoryOrganizeDueClaimResponse = {
  run?: MemoryOrganizeRun | null;
  skippedReason?: string | null;
};

export type MemoryOrganizeRunListResponse = {
  runs: MemoryOrganizeRun[];
};

export type MemoryOrganizeRunClearHistoryResponse = {
  deletedCount: number;
  retainedActiveCount: number;
};

export type MemoryErrorPayload = {
  error: string;
  message: string;
  suggested_next_call?: unknown;
  candidates?: unknown[];
};

export function parseMemoryError(error: unknown): MemoryErrorPayload | null {
  const message = error instanceof Error ? error.message : String(error);
  try {
    const parsed = JSON.parse(message);
    if (parsed && typeof parsed === "object" && typeof parsed.error === "string") {
      return parsed as MemoryErrorPayload;
    }
  } catch {
    // Tauri may wrap the string; fall through to null.
  }
  return null;
}

export function formatMemoryError(error: unknown) {
  const parsed = parseMemoryError(error);
  if (parsed) {
    const extras = [
      parsed.suggested_next_call
        ? `suggested_next_call=${JSON.stringify(parsed.suggested_next_call)}`
        : "",
      parsed.candidates ? `candidates=${JSON.stringify(parsed.candidates)}` : "",
    ].filter(Boolean);
    return [parsed.message, ...extras].join("\n");
  }
  return error instanceof Error ? error.message : String(error);
}

/** 变更类命令：成功后广播「记忆变了」，读取方（如「待审核」角标）据此立刻刷新。 */
const MEMORY_MUTATION_COMMANDS: ReadonlySet<string> = new Set([
  "memory_write",
  "memory_update",
  "memory_delete",
  "memory_delete_project",
  "memory_accept",
  "memory_apply_batch",
  "memory_organize_run_update",
  "memory_organize_due_complete",
  "memory_wipe_all",
]);

async function invokeMemory<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const result = await invoke<T>(command, args);
  if (MEMORY_MUTATION_COMMANDS.has(command)) notifyMemoryChanged();
  return result;
}

export async function memoryList(args: {
  scope?: MemoryScopeFilter;
  workdir?: string;
  includeAllProjects?: boolean;
  memoryType?: MemorySearchType;
  includeDaily?: boolean;
  limit?: number;
  offset?: number;
}) {
  return invokeMemory<MemoryListResponse>("memory_list", { args });
}

export async function memoryRead(args: {
  slug: string;
  scope?: MemoryScopeFilter;
  workdir?: string;
  workdirHash?: string;
  offset?: number;
  length?: number;
}) {
  return invokeMemory<MemoryReadResponse>("memory_read", { args });
}

export async function memorySearch(args: {
  query: string;
  scope?: MemoryScopeFilter;
  workdir?: string;
  memoryType?: MemorySearchType;
  limit?: number;
  includeHistory?: boolean;
  historySince?: number;
  historyUntil?: number;
  historyDateLocal?: string;
  historyTimeMode?: MemoryHistoryTimeMode;
}) {
  return invokeMemory<MemorySearchResponse>("memory_search", { args });
}

export async function memoryWrite(args: {
  slug: string;
  scope: MemoryScope;
  workdir?: string;
  memoryType: MemoryType;
  description: string;
  body: string;
  actor?: string;
  conversationId?: string;
  model?: string;
  evidence?: MemoryEvidenceFields;
}) {
  return invokeMemory<MemoryMutationResponse>("memory_write", { args });
}

export async function memoryUpdate(args: {
  slug: string;
  scope?: MemoryScopeFilter;
  workdir?: string;
  workdirHash?: string;
  memoryType?: MemoryType;
  description?: string;
  body?: string;
  mode?: MemoryUpdateMode;
  actor?: string;
  conversationId?: string;
  model?: string;
  evidence?: MemoryEvidenceFields;
}) {
  return invokeMemory<MemoryMutationResponse>("memory_update", { args });
}

export async function memoryDelete(args: {
  slug: string;
  scope: MemoryScope;
  workdir?: string;
  workdirHash?: string;
  actor?: string;
  reason?: string;
  conversationId?: string;
  model?: string;
}) {
  return invokeMemory<MemoryMutationResponse>("memory_delete", { args });
}

export async function memoryDeleteProject(args: {
  workdir: string;
  actor?: "user" | "tool" | "extractor" | "reconcile";
  reason?: string;
}) {
  return invokeMemory<MemoryDeleteProjectResponse>("memory_delete_project", { args });
}

export async function memoryAccept(args: {
  slug: string;
  scope: MemoryScope;
  workdir?: string;
  workdirHash?: string;
}) {
  return invokeMemory<MemoryMutationResponse>("memory_accept", { args });
}

export async function memoryApplyBatch(args: {
  workdir?: string;
  conversationId?: string;
  trigger?: "memory-extraction" | "memory-organize" | "end" | "compaction";
  model?: string;
  localDate?: string;
  dailyAppend?: {
    bullet: string;
  };
  decisions?: ApplyDecision[];
}) {
  return invokeMemory<MemoryBatchResponse>("memory_apply_batch", { args });
}

export async function memoryOrganizeRunCreate(args: {
  trigger: MemoryOrganizeTrigger;
  dueAt?: number;
  model?: unknown;
  scope?: OrganizerScope;
  mode?: OrganizerMode;
}) {
  return invokeMemory<MemoryOrganizeRunCreateResponse>("memory_organize_run_create", { args });
}

export async function memoryOrganizeRunUpdate(args: {
  runId: string;
  status?: MemoryOrganizeRunStatus;
  startedAt?: number;
  finishedAt?: number;
  inputCount?: number;
  clusterCount?: number;
  safeApplied?: number;
  reviewSkipped?: number;
  createdCount?: number;
  updatedCount?: number;
  deletedCount?: number;
  mergedCount?: number;
  parseFailures?: number;
  error?: string;
  finalSummary?: string;
  phase?: string;
  finalCount?: number;
  compressionRatio?: number;
  compressionTarget?: number;
  dryRun?: boolean;
  tokenUsageTotal?: number;
  quotaHeadroomAtStart?: number;
  overrideReviewed?: boolean;
  report?: unknown;
}) {
  return invokeMemory<MemoryOrganizeRun | null>("memory_organize_run_update", { args });
}

export async function memoryOrganizeRunList(args?: {
  status?: MemoryOrganizeRunStatus;
  limit?: number;
}) {
  return invokeMemory<MemoryOrganizeRunListResponse>("memory_organize_run_list", {
    args: args ?? {},
  });
}

export async function memoryOrganizeRunRead(args: { runId: string }) {
  return invokeMemory<MemoryOrganizeRun | null>("memory_organize_run_read", { args });
}

export async function memoryOrganizeRunClearHistory() {
  return invokeMemory<MemoryOrganizeRunClearHistoryResponse>("memory_organize_run_clear_history");
}

export async function memoryOrganizeDueClaim(args: {
  enabled?: boolean;
  dueAt?: number;
  now?: number;
  model?: unknown;
  scope?: OrganizerScope;
  mode?: OrganizerMode;
}) {
  return invokeMemory<MemoryOrganizeDueClaimResponse>("memory_organize_due_claim", { args });
}

export async function memoryOrganizeDueComplete(
  args: Parameters<typeof memoryOrganizeRunUpdate>[0],
) {
  return invokeMemory<MemoryOrganizeRun | null>("memory_organize_due_complete", { args });
}

export async function memoryIndexOverview(workdir?: string) {
  return invokeMemory<MemoryOverviewResponse>("memory_index_overview", { workdir });
}

export async function memoryRecentRejections(args?: {
  sinceDays?: number;
  limit?: number;
  workdir?: string;
}) {
  return invokeMemory<MemoryRecentRejectionsResponse>("memory_recent_rejections", {
    args: args ?? {},
  });
}

export async function memoryQuotaSummary(args?: { workdir?: string }) {
  return invokeMemory<MemoryQuotaSummaryResponse>("memory_quota_summary", {
    args: args ?? {},
  });
}

export async function memoryPathsInfo() {
  return invokeMemory<MemoryPathsInfo>("memory_paths_info");
}

export async function memoryTodayLocalDate(rolloverHour?: number) {
  return invokeMemory<string>("memory_today_local_date", { rolloverHour });
}

export async function memoryTodayDaily(rolloverHour?: number) {
  return invokeMemory<MemoryReadResponse | null>("memory_today_daily", { rolloverHour });
}

export async function memoryWipeAll() {
  return invokeMemory<MemoryPathsInfo>("memory_wipe_all");
}
