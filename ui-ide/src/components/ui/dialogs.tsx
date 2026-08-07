'use client';

import { ReactNode, useEffect, useRef, useState } from 'react';
import { create } from 'zustand';

export interface DialogRender {
  (close: (result?: unknown) => void): ReactNode;
}

interface DialogEntry {
  id: number;
  render: DialogRender;
  resolve: (value: unknown) => void;
  leaving: boolean;
  kind: 'dialog' | 'popup';
}

interface DialogState {
  stack: DialogEntry[];
  open: (render: DialogRender, kind: 'dialog' | 'popup') => Promise<unknown>;
  close: (id: number, result?: unknown) => void;
}

let seq = 0;

export const useDialogs = create<DialogState>((set, get) => ({
  stack: [],
  open: (render, kind) =>
    new Promise((resolve) => {
      const id = ++seq;
      set((s) => ({ stack: [...s.stack, { id, render, resolve, leaving: false, kind }] }));
    }),
  close: (id, result) => {
    const entry = get().stack.find((d) => d.id === id);
    if (!entry) return;
    entry.resolve(result);
    set((s) => ({ stack: s.stack.map((d) => (d.id === id ? { ...d, leaving: true } : d)) }));
    setTimeout(() => set((s) => ({ stack: s.stack.filter((d) => d.id !== id) })), 150);
  },
}));

export const openDialog = <T = unknown,>(render: DialogRender) => useDialogs.getState().open(render, 'dialog') as Promise<T | undefined>;
export const openPopup = <T = unknown,>(render: DialogRender) => useDialogs.getState().open(render, 'popup') as Promise<T | undefined>;
export const isDialogOpen = () => useDialogs.getState().stack.length > 0;

export function DialogHost() {
  const { stack, close } = useDialogs();
  const top = stack[stack.length - 1];
  useEffect(() => {
    if (!top) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close(top.id);
      }
    };
    addEventListener('keydown', onKey, true);
    return () => removeEventListener('keydown', onKey, true);
  }, [top, close]);
  if (!stack.length) return null;
  return (
    <>
      {stack.map((d) => (
        <div key={d.id} className={`overlay${d.leaving ? ' leaving' : ''}`} onMouseDown={(e) => e.target === e.currentTarget && close(d.id)}>
          {d.render((result) => close(d.id, result))}
        </div>
      ))}
    </>
  );
}

interface DialogFrameProps {
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  hint?: string;
  width?: number;
  small?: boolean;
  onClose: () => void;
}

export function DialogFrame({ title, children, footer, hint, width, small, onClose }: DialogFrameProps) {
  return (
    <div className={`dialog${small ? ' small' : ''}`} style={width ? { width } : undefined}>
      <header>
        <span>{title}</span>
        <button className="dlg-close" onClick={onClose}>×</button>
      </header>
      <div className="dlg-body">{children}</div>
      {footer !== null && (
        <footer>
          {hint && <span className="dlg-hint">{hint}</span>}
          {footer}
        </footer>
      )}
    </div>
  );
}

export type Field =
  | { type?: 'text' | 'password'; name: string; label?: string; value?: string; placeholder?: string; mono?: boolean; hint?: string }
  | { type: 'textarea'; name: string; label?: string; value?: string; placeholder?: string; rows?: number }
  | { type: 'select'; name: string; label?: string; value?: string; options: { value: string; label: string }[] | string[] }
  | { type: 'checkbox'; name: string; label: string; value?: boolean }
  | { type: 'static'; content: ReactNode }
  | { type: 'row'; fields: Field[] };

export type FormValues = Record<string, string | boolean>;

interface FormConfig {
  title: string;
  fields: Field[];
  okText?: string;
  hint?: string;
  width?: number;
  validate?: (v: FormValues) => string | undefined | void;
  onSubmit?: (v: FormValues) => Promise<unknown> | unknown;
}

function initialValues(fields: Field[], acc: FormValues = {}): FormValues {
  for (const f of fields) {
    if (f.type === 'row') initialValues(f.fields, acc);
    else if (f.type === 'static') continue;
    else if (f.type === 'checkbox') acc[f.name] = !!f.value;
    else if (f.type === 'select') acc[f.name] = f.value ?? (typeof f.options[0] === 'string' ? f.options[0] : f.options[0]?.value) ?? '';
    else acc[f.name] = f.value ?? '';
  }
  return acc;
}

function FieldView({ field, values, setValue }: { field: Field; values: FormValues; setValue: (k: string, v: string | boolean) => void }) {
  if (field.type === 'row') return <div className="form-row">{field.fields.map((f, i) => <FieldView key={i} field={f} values={values} setValue={setValue} />)}</div>;
  if (field.type === 'static') return <div className="form-field form-static">{field.content}</div>;
  if (field.type === 'checkbox')
    return (
      <div className="form-field">
        <label className="chk"><input type="checkbox" checked={!!values[field.name]} onChange={(e) => setValue(field.name, e.target.checked)} /><span />{field.label}</label>
      </div>
    );
  const value = String(values[field.name] ?? '');
  return (
    <div className={`form-field${'mono' in field && field.mono ? ' mono' : ''}`}>
      {field.label && <label>{field.label}</label>}
      {field.type === 'textarea' ? (
        <textarea rows={field.rows || 4} placeholder={field.placeholder} value={value} onChange={(e) => setValue(field.name, e.target.value)} />
      ) : field.type === 'select' ? (
        <select value={value} onChange={(e) => setValue(field.name, e.target.value)}>
          {field.options.map((o) => (typeof o === 'string' ? <option key={o} value={o}>{o}</option> : <option key={o.value} value={o.value}>{o.label}</option>))}
        </select>
      ) : (
        <input type={field.type || 'text'} placeholder={field.placeholder} value={value} spellCheck={false} autoComplete="off" onChange={(e) => setValue(field.name, e.target.value)} />
      )}
      {'hint' in field && field.hint && <div className="form-static">{field.hint}</div>}
    </div>
  );
}

function FormDialogView({ config, close }: { config: FormConfig; close: (r?: unknown) => void }) {
  const [values, setValues] = useState<FormValues>(() => initialValues(config.fields));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const first = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = first.current?.querySelector<HTMLInputElement>('input[type=text], input[type=password], textarea, select');
    setTimeout(() => {
      el?.focus();
      if (el instanceof HTMLInputElement) el.select();
    }, 30);
  }, []);
  const submit = async () => {
    const problem = config.validate?.(values);
    if (problem) return setError(problem);
    if (!config.onSubmit) return close(values);
    setBusy(true);
    setError('');
    try {
      const out = await config.onSubmit(values);
      close(out === undefined ? values : out);
    } catch (e: any) {
      setError(e.message);
      setBusy(false);
    }
  };
  return (
    <DialogFrame
      title={config.title}
      hint={config.hint}
      width={config.width}
      onClose={() => close()}
      footer={
        <>
          <button className="btn" onClick={() => close()}>Cancel</button>
          <button className="btn primary" disabled={busy} onClick={submit}>{busy ? 'Working…' : config.okText || 'OK'}</button>
        </>
      }
    >
      <div ref={first} style={{ display: 'contents' }} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLElement).tagName !== 'TEXTAREA' && (e.metaKey || e.ctrlKey || (e.target as HTMLElement).tagName === 'INPUT') && (e.preventDefault(), submit())}>
        {config.fields.map((f, i) => <FieldView key={i} field={f} values={values} setValue={(k, v) => setValues((s) => ({ ...s, [k]: v }))} />)}
        <div className="form-error">{error}</div>
      </div>
    </DialogFrame>
  );
}

export function formDialog(config: FormConfig) {
  return openDialog<FormValues>((close) => <FormDialogView config={config} close={close} />);
}

export async function promptDialog({ title, label = 'Name:', value = '', okText = 'OK', validate, mono = false }: { title: string; label?: string; value?: string; okText?: string; validate?: (v: string) => string | undefined | void; mono?: boolean }): Promise<string | null> {
  const r = await formDialog({ title, okText, fields: [{ name: 'value', label, value, mono }], validate: (v) => validate?.(String(v.value).trim()) });
  return r ? String(r.value).trim() : null;
}

export async function confirmDialog(title: string, okText = 'OK'): Promise<boolean> {
  const r = await formDialog({ title, okText, fields: [], width: 440 });
  return !!r;
}
