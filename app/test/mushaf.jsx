// Run with the Vite dev server at /test/mushaf.html after fetching Mushaf assets.
// Uses a real browser: layout, font loading and ResizeObserver cannot be checked in Node.
import React, { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MushafPage } from '../src/components/MushafPage.jsx';
import '../src/styles.css';

const fixture = document.querySelector('#fixture');
const results = document.querySelector('#results');
const passed = [];
let root = createRoot(fixture);
const render = n => root.render(<StrictMode><MushafPage n={n} /></StrictMode>);
const until = async predicate => {
  const start = performance.now();
  while (!predicate()) {
    if (performance.now() - start > 10000) throw new Error('Page did not become visible');
    await new Promise(resolve => requestAnimationFrame(resolve));
  }
};
const visible = n => {
  const frame = fixture.querySelector('.mushaf-frame');
  return frame && getComputedStyle(frame).fontFamily.includes(`qcf-p${n}`)
    && Number(getComputedStyle(frame).opacity) > 0.99
    && frame.getBoundingClientRect().width > 0 && frame.querySelectorAll('.w').length > 0;
};
const pass = name => { passed.push(name); results.textContent = passed.map(s => `PASS ${s}`).join('\n'); };

try {
  render(343);
  await until(() => visible(343));
  pass('Page 343 renders from a cold cache in StrictMode');
  root.unmount();
  root = createRoot(fixture);
  render(343);
  await until(() => visible(343));
  pass('Reopening cached page 343 stays visible');
  fixture.style.height = '350px';
  await until(() => visible(343) && fixture.querySelector('.mushaf-frame').getBoundingClientRect().height <= 351);
  pass('Page remains visible when the mistake panel reduces available height');
  render(344);
  await until(() => visible(344));
  render(343);
  await until(() => visible(343));
  pass('Switching pages uses the correct cached text and font');
  root.unmount();
  fixture.style.width = '0px';
  fixture.style.height = '0px';
  root = createRoot(fixture);
  render(343);
  await until(() => fixture.querySelector('.mushaf-frame'));
  fixture.style.width = '390px';
  fixture.style.height = '650px';
  await until(() => visible(343));
  pass('Initially hidden cached page renders after its host becomes visible');
  results.textContent += `\n\nAll ${passed.length} rendering checks passed.`;
} catch (error) {
  results.textContent += `\nFAIL ${error.message}`;
  console.error(error);
}
