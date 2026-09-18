import { useRef, useState, type SetStateAction } from 'react'
import { ArrowUp, ChevronDown, Folder, FolderPlus, Laptop, Plus, Square } from 'lucide-react'
import { modelLabel, type PermissionMode } from '../types'
import PermissionsMenu from './PermissionsMenu'

type Props = { value: string; setValue: (value: SetStateAction<string>) => void; model: string; models: string[];
  busy: boolean; disabled: boolean; modelSaving: boolean; onModel: (model: string) => Promise<void>;
  workspace: string; mode: PermissionMode; onMode: (mode: PermissionMode) => Promise<void>; onProject: () => void; onFolders: () => void;
  onSend: (value: string) => Promise<void>; onStop: () => void; onAttach: () => void; onError: (error: string) => void }

export default function Composer(p: Props) {
  const [sending, setSending] = useState(false)
  const input = useRef<HTMLTextAreaElement>(null)
  const submit = async () => {
    if (!p.value.trim() || sending || p.modelSaving || p.busy || p.disabled) return
    setSending(true)
    try { await p.onSend(p.value.trim()); p.setValue(current => current === p.value ? '' : current); input.current?.focus() }
    catch (e) { p.onError((e as Error).message) }
    finally { setSending(false) }
  }
  const changeModel = async (model: string) => {
    if (sending || p.modelSaving || p.busy || p.disabled) return
    try { await p.onModel(model) }
    catch (e) { p.onError((e as Error).message) }
  }
  const models = Array.from(new Set([p.model, ...p.models]))
  return <div className="composer-block">
    <div className="project-context">
      <span className="context-chip"><Laptop size={15} />Local</span>
      <button className="context-chip project-chip" aria-label="Choose project" title={p.workspace} onClick={p.onProject}><Folder size={15} /><span>{p.workspace.split('/').filter(Boolean).pop() || 'Project'}</span></button>
      <button className="context-chip folder-access-button" onClick={p.onFolders}><FolderPlus size={15} /><span>Folder access</span></button>
    </div>
    <div className="composer">
      <textarea ref={input} autoFocus aria-label="Message" placeholder={p.mode === 'plan' ? 'Describe what you want to plan' : 'Describe a task or ask a question'} value={p.value}
        onChange={e => p.setValue(e.target.value)} rows={1}
        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void submit() } }} />
      {p.busy ? <button className="send-button stop-button" aria-label="Stop response" onClick={p.onStop}><Square size={15} fill="currentColor" /></button> :
        <button className="send-button" aria-label="Send message" disabled={!p.value.trim() || sending || p.modelSaving || p.disabled} onClick={() => void submit()}><ArrowUp size={19} /></button>}
    </div>
    <div className="composer-toolbar">
      <button className="attach-button icon-button" aria-label="Add project file" onClick={p.onAttach}><Plus size={19} /></button>
      <PermissionsMenu mode={p.mode} busy={p.busy || p.disabled || sending || p.modelSaving} onChange={p.onMode} onError={p.onError} onDone={() => input.current?.focus()} />
      <span className="composer-spacer" />
      <div className="model-control">
        <select aria-label="Model" value={p.model} disabled={p.disabled || p.busy || sending || p.modelSaving} onChange={e => void changeModel(e.target.value)}
          title={p.modelSaving ? 'Saving model…' : p.busy ? 'Stop the response before changing models.' : 'Choose model'}>
          {models.map(model => <option key={model} value={model}>{modelLabel(model)}</option>)}
        </select><ChevronDown size={12} />
      </div>
    </div>
  </div>
}
