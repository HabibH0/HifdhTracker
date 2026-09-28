import { useSyncExternalStore } from 'react';

// Navigation: bottom tabs + a stack of full-screen routes + one bottom sheet + toasts.
// Android/browser back pops the top layer.
let state = { tab: 'today', visited: { today: true }, stack: [], sheet: null, toasts: [] };
const listeners = new Set();
const emit = () => listeners.forEach(l => l());
const set = patch => { state = { ...state, ...patch }; emit(); };
const subscribe = l => (listeners.add(l), () => listeners.delete(l));
export const useNav = () => useSyncExternalStore(subscribe, () => state);
export const navState = () => state;

let seq = 0, guarded = false;
// One history entry guards all open layers: system back closes the top layer.
const guard = () => { if (!guarded) { history.pushState({ hifdh: true }, ''); guarded = true; } };

window.addEventListener('popstate', () => {
  guarded = false;
  if (state.sheet) set({ sheet: null });
  else if (state.stack.length) {
    const top = state.stack.at(-1);
    if (!(top.props?.onBack && top.props.onBack() === false)) set({ stack: state.stack.slice(0, -1) });
  }
  if (state.sheet || state.stack.length) guard();
});

export const nav = {
  setTab(tab) {
    set({ tab, visited: { ...state.visited, [tab]: true }, stack: [], sheet: null });
  },
  push(type, props = {}, mode = 'push') {
    guard();
    set({ stack: [...state.stack, { id: `${type}-${++seq}`, type, props, mode }] });
  },
  replace(type, props = {}, mode) {
    const top = state.stack.at(-1);
    set({ stack: [...state.stack.slice(0, -1), { id: `${type}-${++seq}`, type, props, mode: mode ?? top?.mode ?? 'push' }] });
  },
  pop() {
    if (!state.stack.length) return;
    set({ stack: state.stack.slice(0, -1) });
  },
  popAll() {
    set({ stack: [], sheet: null });
  },
  openSheet(render, options = {}) {
    guard();
    set({ sheet: { id: ++seq, render, ...options } });
  },
  closeSheet() {
    if (!state.sheet) return;
    set({ sheet: null });
  },
  toast(message, icon = 'check') {
    const id = ++seq;
    set({ toasts: [...state.toasts, { id, message, icon }] });
    setTimeout(() => set({ toasts: state.toasts.filter(t => t.id !== id) }), 2400);
  },
};
