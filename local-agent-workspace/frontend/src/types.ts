export type PermissionMode = 'manual' | 'auto' | 'acceptEdits' | 'plan' | 'bypassPermissions'
export type ToolProfile = 'inherit' | 'read_only' | 'file_editor'
export type Settings = {
  workspace: string; model: string; env_file: string; context_window: number;
  max_output_tokens: number; max_agent_steps: number;
  host: string; configured: boolean;
}
export type Connection = { connected: boolean; models: string[]; error: string | null }
export type RequestInfo = {
  model: string; status: 'running' | 'completed' | 'error' | 'cancelled' | 'interrupted';
  finish_reason?: string; http_status?: number; error_kind?: string;
  usage?: {
    input_tokens?: number; output_tokens?: number; total_tokens?: number;
    cache_read_input_tokens?: number; cache_creation_input_tokens?: number; reasoning_tokens?: number;
  };
}
export type UsageTokenCounts = {
  input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number; reasoning_tokens?: number;
}
export type UsageCounts = {
  calls: number; successful: number; errors: number; rate_limited: number;
  input_tokens: number | null; output_tokens: number | null; cache_read_input_tokens: number | null;
  cache_creation_input_tokens: number | null; reasoning_tokens: number | null; estimated_dbu: number | null;
}
export type InferenceCallMetric = {
  id: string; purpose: 'agent' | 'compaction' | 'title'; model: string;
  created: string | number; status: string; http_status?: number | null;
  usage?: UsageTokenCounts;
  estimated_dbu?: number | null;
}
export type UsageMetrics = {
  scope: 'session'; complete: boolean; totals: UsageCounts; calls: InferenceCallMetric[];
  by_purpose: Array<UsageCounts & { key: string; label: string }>;
  by_model: Array<UsageCounts & { key: string }>;
  pricing: { currency: 'DBU'; unit: string; label: string; source_url: string; effective_at: string; estimated: true };
}
export type DelegationProgress = {
  status: string; completed_tools: number; last_tool?: string; terminal_reason?: string;
}
export type AgentEvent = {
  id: string; type: 'user' | 'assistant' | 'tool' | 'notice' | 'error'; text?: string;
  reasoning_summary?: string; reasoning_truncated?: boolean; child_session_id?: string; request_info?: RequestInfo;
  name?: string; input?: Record<string, unknown>; output?: string; preview?: string;
  state?: 'pending' | 'running' | 'completed' | 'rejected' | 'cancelled' | 'error';
  delegation?: DelegationProgress;
  origin?: { kind: 'delegated'; parent_session_id: string; parent_event_id: string; parent_call_id?: string | null };
}
export type ContextInfo = {
  estimated_tokens: number; input_budget: number; context_window: number; reply_reserve: number;
  compactions: number; summarized_messages: number; estimate_method: 'weighted_utf8' | 'conservative_utf8';
  instruction_files: string[]; warnings: string[];
  instruction_sources?: { path: string; scope: string; status: 'loaded' | 'omitted'; estimated_tokens: number; reason?: string }[];
  prepared_for_next_turn?: boolean;
  breakdown?: { system_instructions: number; tool_definitions: number; messages_and_results: number; summary: number; request_overhead: number };
}
export type Session = {
  id: string; title: string; workspace: string; model: string;
  status: string; events: AgentEvent[]; updated: number;
  permission_mode: PermissionMode; allowed_directories: string[];
  context_info?: ContextInfo; active_skills?: string[]; parent_session_id?: string; is_subagent?: boolean;
  parent_event_id?: string; parent_call_id?: string | null; delegation?: DelegationProgress; terminal_reason?: string;
  tool_profile?: ToolProfile; subagent_tool_profile?: ToolProfile;
}
export type FileEntry = { path: string; name: string; directory: boolean }
export type Job = {
  id: string; session_id: string | null; workspace: string; command: string;
  state: 'running' | 'completed' | 'failed' | 'cancelled' | 'timed_out' | 'interrupted';
  created: number; updated: number; exit_code: number | null; output?: string; truncated: boolean;
  timeout_seconds: number; max_output_bytes: number; background: boolean;
}

export function modelLabel(model: string) {
  return model.replace(/^databricks-/, '').replace(/^system\.ai\./, '')
    .replace(/-/g, ' ').replace(/\b(gpt|oss)\b/gi, s => s.toUpperCase())
    .replace(/\b(\d+)b\b/g, '$1B').replace(/^\w/, s => s.toUpperCase())
}
