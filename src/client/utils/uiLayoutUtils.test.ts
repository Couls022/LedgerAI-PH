import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeFlyoutTop,
  computeResizedColumnWidth,
  DEFAULT_MIN_COL_WIDTH,
  DEFAULT_MAX_COL_WIDTH,
} from './uiLayoutUtils';

describe('uiLayoutUtils — Sidebar Flyout Positioning', () => {
  it('anchors directly at the button top when plenty of viewport space exists', () => {
    const top = computeFlyoutTop(180, 220, 900, 12);
    assert.equal(top, 180);
  });

  it('clamps to bottom viewport margin so lower modules never clip off-screen', () => {
    // Module near bottom of 720px compact laptop viewport (y = 640, panel = 260px)
    const top = computeFlyoutTop(640, 260, 720, 12);
    assert.equal(top, 720 - 260 - 12);
  });

  it('clamps to top margin when anchor is above the viewport', () => {
    const top = computeFlyoutTop(-20, 200, 800, 16);
    assert.equal(top, 16);
  });
});

describe('uiLayoutUtils — Resizable Table Column Widths', () => {
  it('expands and shrinks columns cleanly with drag deltas', () => {
    assert.equal(computeResizedColumnWidth(160, 85), 245);
    assert.equal(computeResizedColumnWidth(200, -60), 140);
  });

  it('enforces minimum readable width and maximum safe width', () => {
    assert.equal(computeResizedColumnWidth(120, -200), DEFAULT_MIN_COL_WIDTH);
    assert.equal(computeResizedColumnWidth(500, 900), DEFAULT_MAX_COL_WIDTH);
  });

  it('supports custom min/max width overrides', () => {
    assert.equal(computeResizedColumnWidth(100, -50, 90, 400), 90);
    assert.equal(computeResizedColumnWidth(350, 100, 90, 400), 400);
  });
});
