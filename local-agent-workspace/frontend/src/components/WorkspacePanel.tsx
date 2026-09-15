import { useCallback, useEffect, useState } from 'react'
import { ArrowLeft, ChevronRight, File, Folder, GitBranch, LoaderCircle, Plus, RefreshCw, Save, Terminal, X } from 'lucide-react'
import { api } from '../api'
import type { FileEntry } from '../types'

type OpenFile = { path: string; content: string; original: string }
export default function WorkspacePanel({ sessionId, workspace, onClose, onAttach }: {
  sessionId: string | null; workspace: string; onClose: () => void; onAttach: (path: string) => void;
}) {
  const [tab, setTab] = useState('files')
  const [directory, setDirectory] = useState('.')
  const [files, setFiles] = useState<FileEntry[]>([])
  const [file, setFile] = useState<OpenFile | null>(null)
  const [changes, setChanges] = useState('')
  const [command, setCommand] = useState('')
  const [output, setOutput] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [running, setRunning] = useState(false)
  const query = sessionId ? `session_id=${sessionId}` : ''
  const refresh = useCallback(async () => {
    setLoading(true); setError('')
    try {
      if (tab === 'files') setFiles(await api<FileEntry[]>(`/files?path=${encodeURIComponent(directory)}&${query}`))
      if (tab === 'changes') {
        const result = await api<{ output: string; exit_code: number }>(`/git?${query}`)
        setChanges(result.output || 'Your working tree is clean.')
      }
    } catch (e) { setError((e as Error).message) }
    finally { setLoading(false) }
  }, [directory, query, tab])
  useEffect(() => { void refresh() }, [refresh])
  const dirty = file && file.content !== file.original
  const openFile = async (path: string) => {
    if (dirty && !confirm('Discard your unsaved edits?')) return
    setError('')
    try {
      const result = await api<{ content: string }>(`/file?path=${encodeURIComponent(path)}&${query}`)
      setFile({ path, content: result.content, original: result.content })
    } catch (e) { setError((e as Error).message) }
  }
  const save = async () => {
    if (!file) return
    setLoading(true); setError('')
    try {
      await api('/file', 'PUT', { ...file, session_id: sessionId })
      setFile({ ...file, original: file.content })
    } catch (e) { setError((e as Error).message) }
    finally { setLoading(false) }
  }
  const run = async () => {
    if (!command.trim() || running) return
    setRunning(true); setError(''); setOutput(`$ ${command}\n\n`)
    try {
      const result = await api<{ output: string; exit_code: number }>(`/command?${query}`, 'POST', { text: command })
      setOutput(`$ ${command}\n\n${result.output}\n[exit ${result.exit_code}]`)
    } catch (e) { setError((e as Error).message) }
    finally { setRunning(false) }
  }
  return <aside className="workspace-panel" aria-label="Workspace panel">
    <header><div><h2>Workspace</h2><p title={workspace}>{workspace.split('/').filter(Boolean).pop()}</p></div>
      <button className="icon-button" aria-label="Close workspace" onClick={() => { if (!dirty || confirm('Discard your unsaved edits?')) onClose() }}><X size={19} /></button></header>
    <nav className="workspace-tabs" aria-label="Workspace views">
      <button className={tab === 'files' ? 'active' : ''} onClick={() => setTab('files')}><Folder size={15} />Files</button>
      <button className={tab === 'changes' ? 'active' : ''} onClick={() => setTab('changes')}><GitBranch size={15} />Changes</button>
      <button className={tab === 'terminal' ? 'active' : ''} onClick={() => setTab('terminal')}><Terminal size={15} />Terminal</button>
    </nav>
    {error ? <div className="panel-error" role="alert">{error}</div> : null}
    {tab === 'files' ? <>
      {file ? <div className="file-editor">
        <div className="editor-toolbar"><button className="icon-button" aria-label="Back to files" onClick={() => { if (!dirty || confirm('Discard unsaved edits?')) setFile(null) }}><ArrowLeft size={16} /></button>
          <span title={file.path}>{file.path}{dirty ? ' •' : ''}</span>
          <button className="icon-button" onClick={() => onAttach(file.path)} aria-label="Add this file to chat"><Plus size={16} /></button>
          <button className="icon-button" onClick={() => void save()} disabled={!dirty || loading} aria-label="Save file"><Save size={16} /></button>
        </div>
        <textarea className="code-editor" aria-label={`Edit ${file.path}`} value={file.content} spellCheck={false} onChange={e => setFile({ ...file, content: e.target.value })} />
        <div className="editor-status">{file.content.split('\n').length} lines<span>{dirty ? 'Unsaved changes' : 'Saved on disk'}</span></div>
      </div> : <div className="file-browser">
        <div className="file-path"><button className="icon-button" aria-label="Parent folder" disabled={directory === '.'} onClick={() => setDirectory(directory.includes('/') ? directory.slice(0, directory.lastIndexOf('/')) : '.')}><ArrowLeft size={15} /></button><span>{directory === '.' ? 'Project files' : directory}</span>
          <button className="icon-button" aria-label="Refresh files" disabled={loading} onClick={() => void refresh()}><RefreshCw size={14} className={loading ? 'spin' : ''} /></button></div>
        <div className="file-list">{files.map(entry => <button key={entry.path} className="file-row" onClick={() => entry.directory ? setDirectory(entry.path) : void openFile(entry.path)}>
          {entry.directory ? <Folder size={16} /> : <File size={16} />}<span>{entry.name}</span>{entry.directory ? <ChevronRight size={13} /> : null}
        </button>)}{!loading && files.length === 0 ? <p className="panel-empty">This folder is empty.</p> : null}</div>
        <p className="panel-footnote">Secret files and generated folders are excluded.</p>
      </div>}
    </> : tab === 'changes' ? <div className="changes-view"><div className="file-path"><span>Working tree</span><button className="icon-button" aria-label="Refresh changes" onClick={() => void refresh()}><RefreshCw size={15} className={loading ? 'spin' : ''} /></button></div>
      <pre className="diff-output">{changes.split('\n').map((line, i) => <span key={i} className={line.startsWith('+') ? 'added' : line.startsWith('-') ? 'removed' : ''}>{line}{'\n'}</span>)}</pre></div> :
      <div className="terminal-view"><p>Run a command in your project folder.</p><form onSubmit={e => { e.preventDefault(); void run() }}>
        <span>$</span><input aria-label="Shell command" placeholder="git status" value={command} onChange={e => setCommand(e.target.value)} disabled={running} />
        <button className="primary" disabled={running || !command.trim()}>{running ? <LoaderCircle size={14} className="spin" /> : 'Run'}</button></form>
        <p className="field-help">Runs when you click Run. Commands can access your machine. Non-interactive, up to 60 seconds.</p>
        <pre className="terminal-output">{output || 'Command output will appear here.'}</pre></div>}
  </aside>
}
