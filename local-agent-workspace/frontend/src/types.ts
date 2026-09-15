export type PermissionMode = 'manual' | 'auto' | 'acceptEdits' | 'plan' | 'bypassPermissions'
export type Settings = {
  workspace: string; runtime: 'databricks' | 'claude'; model: string; env_file: string;
  claude_cli_path: string; claude_mcp_config: string; claude_skills: boolean;
  host: string; configured: boolean;
}
export type Connection = { connected: boolean; models: string[]; error: string | null }
export type AgentEvent = {
  id: string; type: 'user' | 'assistant' | 'tool' | 'notice' | 'error'; text?: string;
  name?: string; input?: Record<string, unknown>; output?: string; preview?: string;
  state?: 'pending' | 'running' | 'completed' | 'rejected' | 'cancelled' | 'error';
}
export type Session = {
  id: string; title: string; workspace: string; runtime: 'databricks' | 'claude'; model: string;
  status: string; events: AgentEvent[]; updated: number;
  permission_mode: PermissionMode; allowed_directories: string[];
}
export type FileEntry = { path: string; name: string; directory: boolean }

export function modelLabel(model: string) {
  return model.replace(/^databricks-/, '').replace(/^system\.ai\./, '')
    .replace(/-/g, ' ').replace(/\b(gpt|oss)\b/gi, s => s.toUpperCase())
    .replace(/\b(\d+)b\b/g, '$1B').replace(/^\w/, s => s.toUpperCase())
}
