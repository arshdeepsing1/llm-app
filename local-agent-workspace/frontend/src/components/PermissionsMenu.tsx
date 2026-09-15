import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, X } from 'lucide-react'
import type { PermissionMode } from '../types'

const modes: { value: PermissionMode; label: string; description: string }[] = [
  { value: 'auto', label: 'Auto', description: 'Accept edits and basic listings; ask for other commands' },
  { value: 'manual', label: 'Manual', description: 'Ask before file changes and commands' },
  { value: 'acceptEdits', label: 'Accept edits', description: 'Accept file edits; ask before commands' },
  { value: 'plan', label: 'Plan', description: 'Explore and plan; no changes or commands' },
  { value: 'bypassPermissions', label: 'Bypass permissions', description: 'Run tools and access folders without asking' },
]

export default function PermissionsMenu({ mode, busy, onChange, onError, onDone }: {
  mode: PermissionMode; busy: boolean; onChange: (mode: PermissionMode) => Promise<void>; onError: (error: string) => void;
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const container = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    menu.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus()
    const outside = (event: PointerEvent) => { if (!container.current?.contains(event.target as Node)) setOpen(false) }
    const focusOutside = (event: FocusEvent) => { if (!container.current?.contains(event.target as Node)) setOpen(false) }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('focusin', focusOutside)
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('focusin', focusOutside) }
  }, [open])
  const choose = async (value: PermissionMode) => {
    setSaving(true)
    try { await onChange(value); setOpen(false); onDone() }
    catch (e) { onError((e as Error).message) }
    finally { setSaving(false) }
  }
  return <div className="permissions-control" ref={container}>
    <button ref={trigger} className="permission-trigger" aria-haspopup="menu" aria-expanded={open}
      aria-label={`Permissions: ${modes.find(m => m.value === mode)?.label}`} onClick={() => setOpen(v => !v)}>
      <ChevronDown size={13} /><span>{modes.find(m => m.value === mode)?.label}</span>
    </button>
    {open ? <div className="permissions-menu" role="menu" aria-label="Permission mode" ref={menu} onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); setOpen(false); trigger.current?.focus() }
      if (event.key === 'Tab') setOpen(false)
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault()
        const items = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') || [])
        const index = items.indexOf(document.activeElement as HTMLButtonElement)
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
        items[next]?.focus()
      }
    }}>
      <div className="permissions-heading">Mode<button className="icon-button" aria-label="Close permissions" onClick={() => { setOpen(false); onDone() }}><X size={14} /></button></div>
      {modes.map(m => <button key={m.value} role="menuitemradio" aria-checked={mode === m.value} aria-disabled={busy || saving}
        onClick={() => { if (!busy && !saving) void choose(m.value) }}>
        <span><span className="permission-name">{m.label}{m.value === 'manual' ? <small>Default</small> : null}</span>
          <span className="permission-description">{m.description}</span></span>
        {mode === m.value ? <Check size={16} className="permission-check" /> : null}
      </button>)}
      <p>{busy ? 'Stop the response before changing modes.' : 'Applies to this conversation. Auto uses local rules.'}</p>
    </div> : null}
  </div>
}
