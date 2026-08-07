type Handler<T = unknown> = (detail: T) => void;

const target = new EventTarget();

export function emit<T = unknown>(type: string, detail?: T) {
  target.dispatchEvent(new CustomEvent(type, { detail }));
}

export function on<T = unknown>(type: string, handler: Handler<T>): () => void {
  const listener = (e: Event) => handler((e as CustomEvent<T>).detail);
  target.addEventListener(type, listener);
  return () => target.removeEventListener(type, listener);
}
