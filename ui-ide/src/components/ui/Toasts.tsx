'use client';

import { create } from 'zustand';

export type ToastType = 'info' | 'success' | 'error';

interface Toast {
  id: number;
  title: string;
  body: string;
  type: ToastType;
  leaving: boolean;
}

interface ToastState {
  toasts: Toast[];
  push: (title: string, body: string, type: ToastType, timeout: number) => void;
  remove: (id: number) => void;
}

let seq = 0;

export const useToasts = create<ToastState>((set, get) => ({
  toasts: [],
  push: (title, body, type, timeout) => {
    const id = ++seq;
    set((s) => ({ toasts: [...s.toasts, { id, title, body, type, leaving: false }] }));
    if (timeout) setTimeout(() => get().remove(id), timeout);
  },
  remove: (id) => {
    set((s) => ({ toasts: s.toasts.map((t) => (t.id === id ? { ...t, leaving: true } : t)) }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 260);
  },
}));

export function toast(title: string, body = '', type: ToastType = 'info', timeout = 4500) {
  useToasts.getState().push(title, body, type, timeout);
}

export function ToastHost() {
  const { toasts, remove } = useToasts();
  return (
    <div className="toast-host">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.type}${t.leaving ? ' leaving' : ''}`} onClick={() => remove(t.id)}>
          <div className="toast-title">{t.title}</div>
          {t.body && <div className="toast-body">{t.body}</div>}
        </div>
      ))}
    </div>
  );
}
