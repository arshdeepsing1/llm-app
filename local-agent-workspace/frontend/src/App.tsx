import { useState, type SetStateAction } from 'react'
import { Folder, Laptop, Menu, PanelRight, Pencil, Terminal, X } from 'lucide-react'
import { api } from './api'
import { useWorkspace } from './useWorkspace'
import Sidebar, { Brand } from './components/Sidebar'
import Composer from './components/Composer'
import Conversation from './components/Conversation'
import AgentToolsDialog from './components/AgentToolsDialog'
import SettingsDialog from './components/SettingsDialog'
import WorkspacePanel, { type OpenFile } from './components/WorkspacePanel'
import FolderAccessDialog from './components/FolderAccessDialog'
import ContextMeter from './components/ContextMeter'

export default function App() {
  const app = useWorkspace()
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const draft = drafts[app.viewKey] || ''
  const setDraft = (value: SetStateAction<string>) => setDrafts(current => ({
    ...current, [app.viewKey]: typeof value === 'function' ? value(current[app.viewKey] || '') : value,
  }))
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [agentToolsOpen, setAgentToolsOpen] = useState(false)
  const [workspaceOpen, setWorkspaceOpen] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [foldersOpen, setFoldersOpen] = useState(false)
  const active = app.session
  const workspace = active?.workspace || app.settings?.workspace || ''
  const editorKey = JSON.stringify([app.viewKey, workspace])
  const [editorDrafts, setEditorDrafts] = useState<Record<string, OpenFile | null>>({})
  const setEditorFile = (value: SetStateAction<OpenFile | null>) => setEditorDrafts(current => ({
    ...current, [editorKey]: typeof value === 'function' ? value(current[editorKey] || null) : value,
  }))
  const hasMessages = !!active?.events.length
  const busy = !!active && active.status !== 'idle'
  const showError = (error: string) => app.setError(error)
  const composer = <Composer key={app.viewKey} value={draft} setValue={setDraft} model={active?.model || app.settings?.model || 'databricks-gpt-oss-120b'}
    workspace={active?.workspace || app.settings?.workspace || ''} mode={app.permissionMode} onMode={app.setPermissionMode} onProject={() => setSettingsOpen(true)}
    onFolders={() => setFoldersOpen(true)}
    models={app.connection?.models || []} busy={busy} hasSession={!!active}
    disabled={!app.ready || (!!app.activeId && !active) || !app.settings?.configured}
    onModel={model => { if (app.settings) void app.saveSettings({ ...app.settings, model }).catch(e => showError(e.message)) }}
    onSend={app.send} onError={showError} onAttach={() => setWorkspaceOpen(true)}
    onStop={() => { if (active) void api(`/sessions/${active.id}/stop`, 'POST').catch(e => showError(e.message)) }} />
  return <div className={`app-shell ${workspaceOpen ? 'workspace-visible' : ''}`}>
    <Sidebar settings={app.settings} connection={app.connection} sessions={app.sessions} activeId={app.activeId}
      open={sidebarOpen} close={() => setSidebarOpen(false)} onNew={app.newConversation}
      onSelect={app.setActiveId} onSettings={() => setSettingsOpen(true)}
      onDelete={id => void app.deleteSession(id).catch(e => showError(e.message))} />
    <main className="main-area">
      <header className="topbar"><button className="icon-button mobile-only" aria-label="Open sidebar" onClick={() => setSidebarOpen(true)}><Menu size={20} /></button>
        <Laptop size={18} className="topbar-device" />
        <span className="conversation-title">{active?.title || (app.activeId ? 'Loading conversation…' : 'New conversation')}
          {app.activeId ? <small className="session-id" title={`Session: ${app.activeId}`}> · {app.activeId.slice(0, 8)}</small> : null}</span>
        <button className="outline agent-tools-toggle" onClick={() => setAgentToolsOpen(true)}>Agent tools</button>
        <button className={`outline workspace-toggle ${workspaceOpen ? 'active' : ''}`} onClick={() => setWorkspaceOpen(v => !v)}><PanelRight size={18} /><span>Workspace</span></button>
      </header>
      {app.error ? <div className="app-error" role="alert"><span>{app.error}</span><button className="icon-button" aria-label="Dismiss error" onClick={() => app.setError('')}><X size={16} /></button></div> : null}
      {!app.online && app.activeId ? <div className="connection-banner">Reconnecting to your local server… Refresh if the server was restarted.</div> : null}
      {app.connection && !app.connection.connected ? <div className="connection-banner"><span>{app.connection.error || 'Configure Databricks to start a conversation.'}</span><button onClick={() => setSettingsOpen(true)}>Open settings</button></div> : null}
      {hasMessages && active ? <Conversation key={active.id} session={active} onError={showError} onSelectSession={app.setActiveId} /> :
        <div className="welcome"><div className="welcome-content"><div className="welcome-heading"><Brand /><h1>What’s up next?</h1></div>
          <div className="suggestions"><button className="outline" onClick={() => setDraft('Explore this project. Read the relevant files and explain its structure and how to run it.')}><Folder size={16} />Explore this project</button>
            <button className="outline" onClick={() => setDraft('Help me make a change in this project: ')}><Pencil size={16} />Make a change</button>
            <button className="outline" onClick={() => setDraft('Run a command in this workspace: ')}><Terminal size={16} />Run a command</button></div>
        </div></div>}
      <div className="chat-composer">{composer}
        {active?.status === 'awaiting_approval' ? <p className="composer-hint" role="status">An action is waiting for your approval above.</p> : null}
        {active?.status === 'compacting' ? <p className="composer-hint" role="status">Compacting context…</p> : null}
        <ContextMeter key={`context-${app.viewKey}`} info={active?.context_info} />
      </div>
    </main>
    {workspaceOpen && app.settings && (!app.activeId || active) ? <WorkspacePanel key={editorKey} sessionId={app.activeId}
      workspace={workspace} file={editorDrafts[editorKey] || null} setFile={setEditorFile} onClose={() => setWorkspaceOpen(false)}
      onAttach={path => { setDraft(current => `${current}${current ? '\n' : ''}Please read the project file: ${path}`); setWorkspaceOpen(false) }} /> : null}
    {agentToolsOpen && app.settings && (!app.activeId || active) ? <AgentToolsDialog key={editorKey} session={active} onClose={() => setAgentToolsOpen(false)} onError={showError} onSelectSession={id => { setAgentToolsOpen(false); app.setActiveId(id); void app.refreshSessions().catch(e => showError(e.message)) }} /> : null}
    {settingsOpen && app.settings ? <SettingsDialog settings={app.settings} connection={app.connection} onSave={app.saveSettings} onClose={() => setSettingsOpen(false)} /> : null}
    {foldersOpen && app.settings ? <FolderAccessDialog key={app.viewKey} workspace={active?.workspace || app.settings.workspace} folders={active?.allowed_directories || []}
      busy={busy || (!!app.activeId && !active)} bypass={app.permissionMode === 'bypassPermissions'} onAllow={app.allowFolder} onRemove={app.removeFolder} onClose={() => setFoldersOpen(false)} /> : null}
  </div>
}
