export type PermissionMode = 'manual' | 'auto' | 'acceptEdits' | 'plan' | 'bypassPermissions'
export type Settings = {
  workspace: string; model: string; env_file: string; context_window: number;
  host: string; configured: boolean;
}
export type Connection = { connected: boolean; models: string[]; error: string | null }
export type AgentEvent = {
  id: string; type: 'user' | 'assistant' | 'tool' | 'notice' | 'error'; text?: string;
  reasoning_summary?: string; reasoning_truncated?: boolean; child_session_id?: string;
  name?: string; input?: Record<string, unknown>; output?: string; preview?: string;
  state?: 'pending' | 'running' | 'completed' | 'rejected' | 'cancelled' | 'error';
}
export type ContextInfo = {
  estimated_tokens: number; input_budget: number; context_window: number; reply_reserve: number;
  compactions: number; summarized_messages: number; estimate_method: 'conservative_utf8';
  instruction_files: string[]; warnings: string[];
}
export type Session = {
  id: string; title: string; workspace: string; model: string;
  status: string; events: AgentEvent[]; updated: number;
  permission_mode: PermissionMode; allowed_directories: string[];
  context_info?: ContextInfo; active_skills?: string[]; parent_session_id?: string; is_subagent?: boolean;
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
