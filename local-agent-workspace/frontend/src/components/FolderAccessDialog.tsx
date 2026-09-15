import { useEffect, useRef, useState } from 'react'
import { Check, Folder, LoaderCircle, X } from 'lucide-react'
import { api } from '../api'

type CheckResult = { accessible: boolean; path: string; error: string | null; python_executable?: string }

export default function FolderAccessDialog({ workspace, folders, busy, bypass, onAllow, onRemove, onClose }: {
  workspace: string; folders: string[]; busy: boolean; bypass: boolean;
  onAllow: (path: string) => Promise<void>; onRemove: (path: string) => Promise<void>; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [path, setPath] = useState('~/Downloads')
  const [result, setResult] = useState<CheckResult | null>(null)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { dialog.current?.showModal() }, [])
  const check = async () => {
    setWorking(true); setError(''); setResult(null)
    try { setResult(await api<CheckResult>('/folder-access/check', 'POST', { path })) }
    catch (e) { setError((e as Error).message) }
    finally { setWorking(false) }
  }
  const change = async (action: () => Promise<void>) => {
    setWorking(true); setError('')
    try { await action() }
    catch (e) { setError((e as Error).message) }
    finally { setWorking(false) }
  }
  const granted = result && (folders.includes(result.path) || result.path === workspace)
  return <dialog ref={dialog} className="settings-dialog folder-access-dialog" aria-labelledby="folder-access-title"
    onCancel={onClose} onClick={e => { if (e.target === dialog.current) onClose() }}>
    <div className="dialog-content">
      <header><div><h2 id="folder-access-title">Folder access</h2><p>Choose folders this conversation can work with.</p></div>
        <button className="icon-button" aria-label="Close folder access" onClick={onClose}><X size={20} /></button></header>
      <div className="folder-grants"><div className="folder-grant"><Folder size={16} /><span title={workspace}>{workspace}<small>Project folder</small></span></div>
        {folders.map(folder => <div className="folder-grant" key={folder}><Folder size={16} /><span title={folder}>{folder}<small>Allowed in this conversation</small></span>
          <button className="icon-button" aria-label={`Remove access to ${folder}`} disabled={working || busy || bypass} onClick={() => void change(() => onRemove(folder))}><X size={15} /></button></div>)}
      </div>
      {bypass ? <p className="settings-note">Bypass permissions allows all folders readable by the server. Select another permission mode to restrict access to the folders listed here.</p> : null}
      <form onSubmit={e => { e.preventDefault(); void check() }}>
        <label>Folder path<input autoFocus value={path} disabled={working} required placeholder="~/Downloads" onChange={e => { setPath(e.target.value); setResult(null); setError('') }} /></label>
        <p className="field-help">Checking access does not read file contents or grant access to the agent.</p>
        <div className="folder-check-actions"><button className="outline" disabled={working || !path.trim()}>{working ? <LoaderCircle size={15} className="spin" /> : null}Check access</button></div>
      </form>
      {result ? <div className={result.accessible ? 'folder-access-success' : 'form-error'} role="status">
        {result.accessible ? <><Check size={16} /><span>{granted ? 'Allowed for this conversation.' : 'The Python server can read this folder.'}</span></> :
          <><p>{result.error}</p>{result.python_executable ? <details><summary>Python used by this server</summary><code>{result.python_executable}</code></details> : null}</>}
      </div> : null}
      <p className="field-help">Allowing a folder lets the agent read its files and send relevant content to your model. File edits follow your selected permission mode. Browser approval cannot change macOS privacy settings.</p>
      {busy ? <p className="field-help">Stop the current response before changing folder access.</p> : null}
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <footer><button className="outline" onClick={onClose}>Done</button><button className="primary" disabled={working || busy || !result?.accessible || !!granted}
        onClick={() => { if (result?.accessible) void change(() => onAllow(result.path)) }}>{granted ? 'Allowed' : 'Allow folder'}</button></footer>
    </div>
  </dialog>
}
