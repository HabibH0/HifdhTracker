import React from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter';
import '@fontsource-variable/newsreader';
import './styles.css';
import App from './App.jsx';
import * as store from './lib/store.js';

if (import.meta.env.DEV) window.__hifdh = store; // debugging aid; stripped from production builds

// No pinch/double-tap zoom anywhere (iOS ignores user-scalable=no on its own).
for (const type of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(type, e => e.preventDefault(), { passive: false });
document.addEventListener('touchmove', e => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });
document.addEventListener('dblclick', e => e.preventDefault(), { passive: false });

createRoot(document.getElementById('root')).render(<App />);
