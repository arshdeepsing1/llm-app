import { useCallback, useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { api } from '../api'
import type { Session, ToolProfile } from '../types'
import ConversationTransfer from './ConversationTransfer'

type Props = { session: Session | null; workspace?: string; onClose: () => void; onSelectSession: (id: string) => void; onError: (message: string) => void }
type Checkpoint = { id: string; path: string; created: number; status: string; turn_id?: string | null }
type Preview = { id: string; path: string; diff: string; expected_current_hash: string; can_restore: boolean; error?: string }
type TurnPreview = { turn_id: string; previews: Preview[]; next_offset: number | null }
type Worktree = { id: string; path: string; branch: string; source_workspace: string; created: number }
type Task = { id: string; title: string; description: string; status: 'pending' | 'in_progress' | 'completed' | 'cancelled'; depends_on: string[] }
type Skill = { id: string; name: string; description: string; path: string }
type Extensions = { servers: unknown[]; hooks: unknown[] }
type ServerDiagnostic = { id: string; name: string; status: 'connected' | 'failed' | 'disabled'; tools: string[]; error?: string }
const profileLabels: Record<ToolProfile, string> = { inherit: 'Inherit permitted tools', read_only: 'Read-only files', file_editor: 'Read and edit files' }
const scopeQuery = (session: Session | null) => session ? `?session_id=${encodeURIComponent(session.id)}` : ''

function useRequest(onError: Props['onError']) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const alive = useRef(false)
  const report = useRef(onError)
  report.current = onError
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  const run = useCallback(async <T,>(operation: () => Promise<T>, success: (value: T) => void) => {
    setBusy(true); setError('')
    try {
      const value = await operation()
      if (alive.current) success(value)
    } catch (e) {
      if (alive.current) { const message = (e as Error).message; setError(message); report.current(message) }
    } finally { if (alive.current) setBusy(false) }
  }, [])
  return { busy, error, run }
}

export default function AgentToolsDialog(props: Props) {
  return <AgentToolsScope key={props.session?.id || 'draft'} {...props} />
}

function AgentToolsScope(props: Props) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [tab, setTab] = useState('Recovery')
  useEffect(() => { dialog.current?.showModal() }, [])
  return <dialog className="agent-tools-dialog" ref={dialog} aria-label="Agent tools" onCancel={props.onClose} onClick={e => { if (e.target === dialog.current) props.onClose() }}>
    <div className="agent-tools-content">
      <header className="agent-tools-header"><div><h2>Agent tools</h2><p>{props.session?.title || 'Default workspace'}</p></div><button className="icon-button" aria-label="Close agent tools" onClick={props.onClose}><X size={18} /></button></header>
      <nav className="agent-tools-tabs" aria-label="Agent tools sections">{['Recovery', 'Worktrees', 'Tasks', 'Extensions', 'Conversation'].map(name => <button key={name} aria-pressed={tab === name} onClick={() => setTab(name)}>{name}</button>)}</nav>
      {tab === 'Recovery' ? <Recovery {...props} /> : tab === 'Worktrees' ? <Worktrees {...props} /> : tab === 'Tasks' ? <Tasks {...props} /> : tab === 'Extensions' ? <ExtensionsPanel {...props} /> :
        <ConversationTransfer sessionId={props.session?.id} workspace={props.session?.workspace || props.workspace || ''} busy={!!props.session && props.session.status !== 'idle'} onError={props.onError} onSelectSession={id => { props.onSelectSession(id); props.onClose() }} />}
    </div>
  </dialog>
}

function Recovery({ session, onError }: Props) {
  const query = scopeQuery(session)
  const { busy, error, run } = useRequest(onError)
  const [items, setItems] = useState<Checkpoint[]>([])
  const [previews, setPreviews] = useState<Preview[]>([])
  const [turnPreview, setTurnPreview] = useState<TurnPreview | null>(null)
  const [notice, setNotice] = useState('')
  const refresh = useCallback(() => run(() => api<Checkpoint[]>(`/checkpoints${query}`), setItems), [query, run])
  useEffect(() => { void refresh() }, [refresh])
  const groups = new Map<string, Checkpoint[]>()
  for (const item of items) {
    const key = item.turn_id || ''
    groups.set(key, [...(groups.get(key) || []), item])
  }
  const previewTurn = (turnId: string, offset = 0) => {
    setNotice('')
    if (!offset) { setPreviews([]); setTurnPreview(null) }
    void run(() => api<TurnPreview>(`/checkpoint-turns/${encodeURIComponent(turnId)}/preview${query}&offset=${offset}`), result => {
      setTurnPreview(result)
      setPreviews(current => offset ? [...current, ...result.previews] : result.previews)
    })
  }
  return <section className="agent-tools-section" aria-label="Recovery">
    <div className="agent-tools-section-heading"><h3>File checkpoints</h3><button className="outline" disabled={busy} onClick={() => void refresh()}>Refresh checkpoints</button></div>
    <p>Preview file checkpoints by user turn, then restore individual files. Commands and MCP side effects are not reversible here.</p>
    {error ? <p className="form-error" role="alert">{error}</p> : null}
    {notice ? <p role="status">{notice}</p> : null}
    <div className="agent-tools-list">{Array.from(groups, ([turnId, checkpoints]) => <section className="recovery-turn" key={turnId || 'unassociated'}>
      <div className="agent-tools-section-heading"><div><h4>{turnId ? 'User turn' : 'Other file edits'}</h4>
        {turnId ? <p>{session?.events.find(event => event.id === turnId && event.type === 'user')?.text?.slice(0, 160) || `Turn ${turnId.slice(0, 8)}`}</p> : <p>Manual edits, restores, or older checkpoints without turn metadata.</p>}</div>
        {turnId ? <button className="outline" disabled={busy} aria-label={`Preview turn ${turnId}`} onClick={() => previewTurn(turnId)}>Preview turn</button> : null}</div>
      {checkpoints.map(item => <div className="agent-tools-row" key={item.id}><div><strong>{item.path}</strong><small>{item.status}</small></div>
        <button className="outline" disabled={busy} aria-label={`Preview checkpoint ${item.path}`} onClick={() => { setNotice(''); setPreviews([]); setTurnPreview(null); void run(() => api<Preview>(`/checkpoints/${encodeURIComponent(item.id)}/preview${query}`), result => setPreviews([result])) }}>Preview</button></div>)}
    </section>)}</div>
    {!busy && !items.length ? <p className="muted">No saved file checkpoints in this workspace scope.</p> : null}
    {turnPreview ? <p>Individual checkpoints, newest first. Earlier edits to the same file may no longer be restorable. This is not a whole-turn undo.</p> : null}
    {previews.map(preview => <div className="agent-tools-preview" key={preview.id} role="group" aria-label={`Recovery preview ${preview.path}`}><h4>{preview.path}</h4><pre>{preview.diff || 'No content difference.'}</pre>
      {preview.error ? <p role="alert">{preview.error}</p> : null}
      <button className="primary" disabled={busy || !preview.can_restore} onClick={() => void run(async () => {
        await api(`/checkpoints/${encodeURIComponent(preview.id)}/restore${query}`, 'POST', { expected_current_hash: preview.expected_current_hash })
        return api<Checkpoint[]>(`/checkpoints${query}`)
      }, items => { setItems(items); setNotice(`Restored ${preview.path}.`); setPreviews([]); setTurnPreview(null) })}>Restore checkpoint</button>
    </div>)}
    {turnPreview?.next_offset != null ? <button className="outline" disabled={busy} onClick={() => previewTurn(turnPreview.turn_id, turnPreview.next_offset!)}>More checkpoints in this turn</button> : null}
  </section>
}

function Worktrees({ session, onError, onSelectSession, onClose }: Props) {
  const query = scopeQuery(session)
  const { busy, error, run } = useRequest(onError)
  const [items, setItems] = useState<Worktree[]>([])
  const [branch, setBranch] = useState('')
  const refresh = useCallback(() => run(() => api<Worktree[]>(`/worktrees${query}`), setItems), [query, run])
  useEffect(() => { void refresh() }, [refresh])
  return <section className="agent-tools-section" aria-label="Worktrees">
    <div className="agent-tools-section-heading"><h3>Isolated worktrees</h3><button className="outline" disabled={busy} onClick={() => void refresh()}>Refresh worktrees</button></div>
    <p>Create a fresh branch from committed HEAD. Uncommitted changes are not copied.</p>
    <form className="agent-tools-form" onSubmit={e => { e.preventDefault(); void run(async () => {
      await api(`/worktrees${query}`, 'POST', { branch: branch.trim() })
      return api<Worktree[]>(`/worktrees${query}`)
    }, items => { setItems(items); setBranch('') }) }}><label>New branch<input required disabled={busy} value={branch} onChange={e => setBranch(e.target.value)} placeholder="codex/my-change" /></label><button className="primary" disabled={busy || !branch.trim()}>Create worktree</button></form>
    {error ? <p className="form-error" role="alert">{error}</p> : null}
    <div className="agent-tools-list">{items.map(item => <div className="agent-tools-row" key={item.id}><div><strong>{item.branch}</strong><small>{item.path}</small></div><div className="agent-tools-actions">
      <button className="outline" disabled={busy} aria-label={`Open conversation in ${item.branch}`} onClick={() => void run(() => api<Session>(`/worktrees/${encodeURIComponent(item.id)}/session${query}`, 'POST'), created => { onSelectSession(created.id); onClose() })}>Open conversation</button>
      <button className="outline" disabled={busy} aria-label={`Remove worktree ${item.branch}`} onClick={() => void run(async () => { await api(`/worktrees/${encodeURIComponent(item.id)}${query}`, 'DELETE'); return api<Worktree[]>(`/worktrees${query}`) }, setItems)}>Remove</button>
    </div></div>)}</div>
    {!busy && !items.length ? <p className="muted">No managed worktrees in this workspace scope.</p> : null}
    <p className="field-help">Removing a worktree preserves its branch. Worktrees with uncommitted changes or conversations in use cannot be removed.</p>
  </section>
}

function Tasks(props: Props) {
  return props.session ? <SessionTasks {...props} session={props.session} /> : <section className="agent-tools-section"><p>Start a conversation to manage tasks and subagents.</p></section>
}

function SessionTasks({ session, onError, onSelectSession, onClose }: Props & { session: Session }) {
  const path = `/sessions/${encodeURIComponent(session.id)}`
  const { busy, error, run } = useRequest(onError)
  const [tasks, setTasks] = useState<Task[]>([])
  const [children, setChildren] = useState<Session[]>([])
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [dependencies, setDependencies] = useState<string[]>([])
  const [profile, setProfile] = useState<ToolProfile>(session.subagent_tool_profile || 'inherit')
  const [profileNotice, setProfileNotice] = useState('')
  const refresh = useCallback(() => run(() => Promise.all([api<Task[]>(`${path}/tasks`), api<Session[]>(`${path}/children`)]), ([tasks, children]) => { setTasks(tasks); setChildren(children) }), [path, run])
  useEffect(() => { void refresh() }, [refresh])
  const update = (task: Task, status: Task['status']) => void run(() => api<Task>(`${path}/tasks/${encodeURIComponent(task.id)}`, 'PATCH', { status }), updated => setTasks(current => current.map(item => item.id === updated.id ? updated : item)))
  return <section className="agent-tools-section" aria-label="Tasks">
    <div className="agent-tools-section-heading"><h3>Conversation tasks</h3><button className="outline" disabled={busy} onClick={() => void refresh()}>Refresh tasks and subagents</button></div>
    <form className="agent-tools-form" onSubmit={e => { e.preventDefault(); void run(() => api<Task>(`${path}/tasks`, 'POST', { title: title.trim(), description, depends_on: dependencies }), task => { setTasks(current => [...current, task]); setTitle(''); setDescription(''); setDependencies([]) }) }}>
      <label>Task title<input required disabled={busy} maxLength={200} value={title} onChange={e => setTitle(e.target.value)} /></label>
      <label>Task description<textarea disabled={busy} maxLength={4000} value={description} onChange={e => setDescription(e.target.value)} /></label>
      {tasks.length ? <details className="agent-tools-dependencies"><summary>Dependencies</summary>{tasks.map(task => <label key={task.id}><input type="checkbox" disabled={busy} checked={dependencies.includes(task.id)} onChange={e => setDependencies(current => e.target.checked ? [...current, task.id] : current.filter(id => id !== task.id))} />{task.title}</label>)}</details> : null}
      <button className="primary" disabled={busy || !title.trim() || tasks.length >= 50}>Add task</button>
    </form>
    {error ? <p className="form-error" role="alert">{error}</p> : null}
    <div className="agent-tools-list">{tasks.map(task => <div className="agent-tools-row" key={task.id}><div><label className="agent-tools-task"><input type="checkbox" aria-label={`Complete task ${task.title}`} disabled={busy} checked={task.status === 'completed'} onChange={e => update(task, e.target.checked ? 'completed' : 'pending')} /><strong>{task.title}</strong></label>
      {task.description ? <p>{task.description}</p> : null}{task.depends_on.length ? <small>Depends on: {task.depends_on.map(id => tasks.find(item => item.id === id)?.title || id).join(', ')}</small> : null}</div>
      <select aria-label={`Status for ${task.title}`} disabled={busy} value={task.status} onChange={e => update(task, e.target.value as Task['status'])}>{(['pending', 'in_progress', 'completed', 'cancelled'] as const).map(status => <option key={status} value={status}>{status.replace('_', ' ')}</option>)}</select>
    </div>)}</div>
    {!busy && !tasks.length ? <p className="muted">No tasks in this conversation yet.</p> : null}
    <h3>Subagents</h3><p className="field-help">Open a child conversation to review its progress or approve a pending action.</p>
    {session.is_subagent ? <p>Tool profile: {profileLabels[session.tool_profile || 'inherit']}. This child cannot widen its inherited tool access.</p> : <>
      <label className="agent-tools-profile">New subagent tool ceiling<select aria-label="New subagent tool ceiling" disabled={busy || session.status !== 'idle'} value={profile} onChange={e => {
        const selected = e.target.value as ToolProfile
        setProfileNotice('')
        void run(() => api<Session>(`${path}/subagent-profile`, 'PUT', { tool_profile: selected }), updated => { setProfile(updated.subagent_tool_profile || 'inherit'); setProfileNotice('Tool ceiling saved for new subagents.') })
      }}>{Object.entries(profileLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <p className="field-help">Applies to new subagents only. File-only profiles disable commands, MCP and hooks; normal approvals still apply. This limits agent tools, not your editor or terminal.</p>
      {profileNotice ? <p role="status">{profileNotice}</p> : null}
    </>}
    <div className="agent-tools-list">{children.map(child => <div className="agent-tools-row" key={child.id}><div><strong>{child.title}</strong><small>{child.status === 'awaiting_approval' ? 'Waiting for approval' : child.status}</small><small>{profileLabels[child.tool_profile || 'inherit']}</small></div><button className="outline" aria-label={`Open subagent ${child.title}`} onClick={() => { onSelectSession(child.id); onClose() }}>Open</button></div>)}</div>
    {!busy && !children.length ? <p className="muted">No subagents in this conversation.</p> : null}
  </section>
}

function ExtensionsPanel({ session, onError }: Props) {
  const query = scopeQuery(session)
  const { busy, error, run } = useRequest(onError)
  const [configuration, setConfiguration] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [skills, setSkills] = useState<Skill[]>([])
  const [activeSkills, setActiveSkills] = useState<string[]>((session as (Session & { active_skills?: string[] }) | null)?.active_skills || [])
  const [notice, setNotice] = useState('')
  const [tools, setTools] = useState<string[] | null>(null)
  const [servers, setServers] = useState<ServerDiagnostic[] | null>(null)
  useEffect(() => { void run(() => Promise.all([api<Extensions>('/extensions'), api<Skill[]>(`/skills${query}`)]), ([config, skills]) => { setConfiguration(JSON.stringify(config, null, 2)); setSkills(skills); setLoaded(true) }) }, [query, run])
  return <section className="agent-tools-section" aria-label="Extensions">
    <h3>MCP servers and hooks</h3>
    <p>Configure stdio commands or HTTP server URLs and before_tool / after_tool / tool_failure hooks. Saving authorizes enabled servers to start.</p>
    <label className="agent-tools-config">Extension configuration (JSON)<textarea aria-label="Extension configuration (JSON)" disabled={!loaded || busy} spellCheck={false} value={configuration} onChange={e => setConfiguration(e.target.value)} /></label>
    <details className="agent-tools-example"><summary>Configuration example</summary><pre>{JSON.stringify({ servers: [{ id: 'example', name: 'Example MCP', transport: 'stdio', command: 'your-mcp-server', args: [], enabled: false }], hooks: [{ id: 'example-hook', event: 'before_tool', tools: ['write_file', 'edit_file'], command: 'your-hook-command', timeout_seconds: 10, enabled: false }] }, null, 2)}</pre><p>The optional tools list matches exact tool names. Omit it to match all tools; an empty list matches none. Hook input includes call_id; failure hooks also receive the original error.</p></details>
    <div className="agent-tools-actions"><button className="primary" disabled={!loaded || busy || !configuration.trim()} onClick={() => { setNotice(''); setTools(null); setServers(null); void run(() => api<Extensions>('/extensions', 'PUT', JSON.parse(configuration)), config => { setConfiguration(JSON.stringify(config, null, 2)); setNotice('Configuration saved.') }) }}>Save configuration</button>
      <button className="outline" disabled={busy} onClick={() => { setNotice(''); setTools(null); setServers(null); void run(() => api<{ tools: string[]; servers?: ServerDiagnostic[] }>('/extensions/test', 'POST'), result => { setTools(result.tools); setServers(result.servers || null) }) }}>Test saved configuration</button></div>
    {error ? <p className="form-error" role="alert">{error}</p> : null}{notice ? <p role="status">{notice}</p> : null}
    {tools ? <div className="agent-tools-test" role="status">{tools.length ? <><strong>Available tools</strong><ul>{tools.map(tool => <li key={tool}>{tool}</li>)}</ul></> : 'No tools reported by the saved configuration.'}</div> : null}
    {servers ? <div className="agent-tools-list" aria-label="MCP server test results"><p className="field-help">Results from the last test, not a live connection monitor.</p>{servers.map(server => <div className="agent-tools-row" key={server.id}><div><strong>{server.name}</strong><small>{server.status === 'connected' ? `Connected during test · ${server.tools.length} tools` : server.status === 'disabled' ? 'Disabled · not started' : 'Failed'}</small>{server.error ? <p className="form-error">{server.error}</p> : null}</div></div>)}</div> : null}
    <h3>Skills</h3>{!session ? <p className="field-help">Start a conversation to enable skills.</p> : null}
    <div className="agent-tools-list">{skills.map(skill => <div className="agent-tools-row" key={skill.id}><label><input type="checkbox" disabled={busy || !session} checked={activeSkills.includes(skill.id)} onChange={e => { if (session) void run(() => api<{ active_skills: string[] }>(`/sessions/${encodeURIComponent(session.id)}/skills`, 'POST', { skill_id: skill.id, enabled: e.target.checked }), result => setActiveSkills(result.active_skills)) }} />{skill.name}<small>{skill.description}</small><small>{skill.path}</small></label></div>)}</div>
    {!busy && !skills.length ? <p className="muted">No installed skills found.</p> : null}
  </section>
}
