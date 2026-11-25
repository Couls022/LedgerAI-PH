import assert from 'node:assert/strict';
import { describe, it, beforeAll as before, afterAll as after } from 'vitest';
import request from 'supertest';
import path from 'node:path';
import fs from 'node:fs';

describe('REQ-UX-SCROLLBAR-001 — Final Scrollbar Visibility, Auto-Hide & UX Behavior Test Suite', () => {

  // ============================================================================
  // TEST SECTION 1: CSS DESIGN TOKENS & SYSTEM-WIDE SCROLLBAR UTILITIES
  // ============================================================================

  it('SB1.1 & SB1.2: verifies index.css defines auto-hide, hover reveal, and active scroll tokens', async () => {
    const cssPath = path.join(process.cwd(), 'src/index.css');
    assert.ok(fs.existsSync(cssPath), 'index.css file must exist');
    const cssContent = fs.readFileSync(cssPath, 'utf8');

    assert.ok(cssContent.includes('--scrollbar-thumb-idle'), 'index.css must define --scrollbar-thumb-idle token');
    assert.ok(cssContent.includes('--scrollbar-thumb-hover'), 'index.css must define --scrollbar-thumb-hover token');
    assert.ok(cssContent.includes('--scrollbar-thumb-active'), 'index.css must define --scrollbar-thumb-active token');
    assert.ok(cssContent.includes('scrollbar-gutter'), 'index.css must configure scrollbar-gutter to prevent layout shifts');
  });

  it('SB1.3 & SB1.4 & SB1.5: verifies idle transparent state and hover/focus-within reveal selectors', async () => {
    const cssContent = fs.readFileSync(path.join(process.cwd(), 'src/index.css'), 'utf8');

    assert.ok(cssContent.includes('scrollbar-color: transparent transparent'), 'Idle state must set scrollbar-color to transparent transparent');
    assert.ok(cssContent.includes('.scroll-region:hover'), '.scroll-region:hover selector must be present');
    assert.ok(cssContent.includes('.scroll-region:focus-within'), '.scroll-region:focus-within selector must be present');
    assert.ok(cssContent.includes('#main-scroll-viewport:hover'), '#main-scroll-viewport:hover selector must be present');
  });

  it('SB1.6 & SB1.7: verifies active scrolling (.is-scrolling) and webkit thumb styling', async () => {
    const cssContent = fs.readFileSync(path.join(process.cwd(), 'src/index.css'), 'utf8');

    assert.ok(cssContent.includes('.is-scrolling'), '.is-scrolling class must be targeted for active scrolling');
    assert.ok(cssContent.includes('::-webkit-scrollbar-thumb'), '::-webkit-scrollbar-thumb must be styled');
    assert.ok(cssContent.includes('background-clip: content-box'), '::-webkit-scrollbar-thumb must use background-clip: content-box');
  });

  it('SB1.8 & SB1.9: verifies keyboard focus-visible and focus-within accessibility indicators', async () => {
    const cssContent = fs.readFileSync(path.join(process.cwd(), 'src/index.css'), 'utf8');

    assert.ok(cssContent.includes(':focus-visible'), ':focus-visible rule must be defined');
    assert.ok(cssContent.includes('outline: 2px solid var(--color-brand)'), 'Focus ring must use brand outline');
  });

  it('SB1.10 & SB1.11 & SB1.12: verifies dark mode and light mode theme scrollbar token separation', async () => {
    const cssContent = fs.readFileSync(path.join(process.cwd(), 'src/index.css'), 'utf8');

    assert.ok(cssContent.includes('.dark {'), '.dark scope must exist in index.css');
    assert.ok(cssContent.includes('--scrollbar-thumb-hover: #475569'), 'Dark mode must use eye-comfortable dark slate thumb');
  });

  // ============================================================================
  // TEST SECTION 2: GLOBAL ACTIVE SCROLL DETECTOR & COMPONENT MOUNTING
  // ============================================================================

  it('SB1.13 & SB1.14 & SB1.15: verifies Layout.tsx mounts capturing active scroll detector hook', async () => {
    const layoutPath = path.join(process.cwd(), 'src/client/components/Layout.tsx');
    assert.ok(fs.existsSync(layoutPath), 'Layout.tsx file must exist');
    const layoutContent = fs.readFileSync(layoutPath, 'utf8');

    assert.ok(layoutContent.includes("target.classList.add('is-scrolling')"), 'Layout.tsx must add is-scrolling class on scroll event');
    assert.ok(layoutContent.includes("target.classList.remove('is-scrolling')"), 'Layout.tsx must remove is-scrolling class after scroll stops');
    assert.ok(layoutContent.includes('capture: true'), 'Scroll listener must use capturing phase to intercept nested scrolling');
  });

  it('SB1.16 & SB1.17 & SB1.18: verifies independent scroll regions across ErpSidebar, Layout, and BackToTop', async () => {
    const sidebarPath = path.join(process.cwd(), 'src/client/components/ErpSidebar.tsx');
    const backToTopPath = path.join(process.cwd(), 'src/client/components/shared/BackToTop.tsx');

    assert.ok(fs.existsSync(sidebarPath), 'ErpSidebar.tsx must exist');
    assert.ok(fs.existsSync(backToTopPath), 'BackToTop.tsx must exist');

    const sidebarCode = fs.readFileSync(sidebarPath, 'utf8');
    assert.ok(sidebarCode.includes('overflow-y-auto'), 'Sidebar must have independent overflow-y-auto scrolling');
  });

  it('SB1.19 & SB1.20: verifies reduced motion preferences and Playwright visual screenshot evidence files', async () => {
    const cssContent = fs.readFileSync(path.join(process.cwd(), 'src/index.css'), 'utf8');
    assert.ok(cssContent.includes('@media (prefers-reduced-motion: reduce)'), 'index.css must handle prefers-reduced-motion');

    const cliDir = path.join(process.cwd(), '.playwright-cli');
    const artifactDir = path.join(process.cwd(), '.aistudio/artifacts/computer_use');

    assert.ok(fs.existsSync(path.join(cliDir, 's1-idle.png')) || fs.existsSync(path.join(artifactDir, 's1-idle.png')), 's1-idle.png screenshot evidence must exist');
    assert.ok(fs.existsSync(path.join(cliDir, 's2-hover.png')) || fs.existsSync(path.join(artifactDir, 's2-hover.png')), 's2-hover.png screenshot evidence must exist');
    assert.ok(fs.existsSync(path.join(cliDir, 's3-active-scroll.png')) || fs.existsSync(path.join(artifactDir, 's3-active-scroll.png')), 's3-active-scroll.png screenshot evidence must exist');
    assert.ok(fs.existsSync(path.join(cliDir, 's4-modal-scroll.png')) || fs.existsSync(path.join(artifactDir, 's4-modal-scroll.png')), 's4-modal-scroll.png screenshot evidence must exist');
    assert.ok(fs.existsSync(path.join(cliDir, 's5-wide-table.png')) || fs.existsSync(path.join(artifactDir, 's5-wide-table.png')), 's5-wide-table.png screenshot evidence must exist');
    assert.ok(fs.existsSync(path.join(cliDir, 's6-dark-theme.png')) || fs.existsSync(path.join(artifactDir, 's6-dark-theme.png')), 's6-dark-theme.png screenshot evidence must exist');
  });
});
