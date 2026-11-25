/**
 * Pure UI layout & interaction utilities for LedgerAI PH.
 * Covers viewport-clamped flyout positioning and pointer-driven table column resizing.
 */

export const DEFAULT_MIN_COL_WIDTH = 72;
export const DEFAULT_MAX_COL_WIDTH = 960;

/**
 * Computes a viewport-safe `top` coordinate (in px) for a sidebar rail flyout
 * anchored next to a clicked icon button, preventing top/bottom viewport clipping.
 */
export function computeFlyoutTop(
  anchorTop: number,
  panelHeight: number,
  viewportHeight: number,
  margin: number = 12
): number {
  const safeViewport = Math.max(viewportHeight, margin * 2 + 80);
  const safePanel = Math.max(0, panelHeight);
  const maxTop = Math.max(margin, safeViewport - safePanel - margin);
  if (anchorTop < margin) return margin;
  if (anchorTop > maxTop) return maxTop;
  return Math.round(anchorTop);
}

/**
 * Clamps a drag-resized table column width within safe readable bounds.
 */
export function computeResizedColumnWidth(
  startWidth: number,
  deltaX: number,
  minWidth: number = DEFAULT_MIN_COL_WIDTH,
  maxWidth: number = DEFAULT_MAX_COL_WIDTH
): number {
  const raw = Math.round(startWidth + deltaX);
  if (raw < minWidth) return minWidth;
  if (raw > maxWidth) return maxWidth;
  return raw;
}

export interface ResizableTablesHandle {
  resetAllWidths: () => void;
  cleanup: () => void;
}

/**
 * Attaches unobtrusive left/right drag-to-resize column handles to every eligible
 * data `<table>` inside `rootEl`. Automatically observes dynamically mounted tables
 * (e.g., async data loads or tab switches) and cleans up all listeners on unmount.
 *
 * Skips print-only tables (`.bir-2307-print-only`), tables with `data-no-resize="true"`,
 * and tables with fewer than 2 header cells.
 */
export interface ResizableTablesOptions {
  skipInsideTableScrollContainer?: boolean;
}

export function attachResizableTableColumns(
  rootEl: HTMLElement,
  onResizeStateChange?: (hasCustomWidths: boolean) => void,
  options: ResizableTablesOptions = {}
): ResizableTablesHandle {
  const activeCleanupFns: Array<() => void> = [];
  const resizedTables = new Set<HTMLTableElement>();

  const notifyChange = () => {
    if (onResizeStateChange) {
      onResizeStateChange(resizedTables.size > 0);
    }
  };

  const enhanceTable = (table: HTMLTableElement) => {
    if (table.dataset.colResizeEnhanced === 'true') return;
    if (table.dataset.noResize === 'true') return;
    if (table.closest('.bir-2307-print-only')) return;
    if (options.skipInsideTableScrollContainer && table.closest('.table-scroll-wrapper')) return;

    const thead = table.querySelector('thead');
    if (!thead) return;

    const headerRows = Array.from(thead.querySelectorAll('tr'));
    if (headerRows.length === 0) return;

    // Use the last header row (leaf column headers) for resizing
    const targetRow = headerRows[headerRows.length - 1];
    const headers = Array.from(targetRow.children).filter(
      (cell): cell is HTMLTableCellElement => cell.tagName === 'TH'
    );
    if (headers.length < 2) return;

    table.dataset.colResizeEnhanced = 'true';

    headers.forEach((th, colIdx) => {
      if (th.querySelector(':scope > .col-resize-handle')) return;

      // Ensure positioning context without breaking sticky headers
      const computedPos = window.getComputedStyle(th).position;
      if (computedPos === 'static') {
        th.style.position = 'relative';
      }

      const handle = document.createElement('span');
      handle.className = 'col-resize-handle';
      handle.setAttribute('role', 'separator');
      handle.setAttribute('aria-orientation', 'vertical');
      handle.setAttribute('aria-label', `Resize column ${colIdx + 1}`);
      handle.setAttribute('data-testid', `col-resize-handle-${colIdx}`);
      handle.title = 'Drag left or right to resize column (double-click to reset)';

      const onPointerDown = (e: PointerEvent) => {
        if (e.button !== 0 && e.pointerType === 'mouse') return;
        e.preventDefault();
        e.stopPropagation();

        // Snapshot current rendered widths of all columns so other columns stay stable
        const currentWidths = headers.map((cell) => Math.max(DEFAULT_MIN_COL_WIDTH, Math.round(cell.getBoundingClientRect().width)));
        headers.forEach((cell, idx) => {
          cell.style.width = `${currentWidths[idx]}px`;
          cell.style.minWidth = `${DEFAULT_MIN_COL_WIDTH}px`;
        });

        const startX = e.clientX;
        const startColWidth = currentWidths[colIdx];
        const startTableWidth = Math.round(table.getBoundingClientRect().width);

        table.style.tableLayout = 'fixed';
        table.style.width = `${startTableWidth}px`;
        handle.classList.add('is-dragging');
        document.body.classList.add('is-col-resizing');

        const onPointerMove = (moveEvent: PointerEvent) => {
          const deltaX = moveEvent.clientX - startX;
          const nextColWidth = computeResizedColumnWidth(startColWidth, deltaX);
          const actualDelta = nextColWidth - startColWidth;
          th.style.width = `${nextColWidth}px`;
          table.style.width = `${Math.max(startTableWidth + actualDelta, 280)}px`;
        };

        const finishDrag = () => {
          handle.classList.remove('is-dragging');
          document.body.classList.remove('is-col-resizing');
          window.removeEventListener('pointermove', onPointerMove);
          window.removeEventListener('pointerup', finishDrag);
          window.removeEventListener('pointercancel', finishDrag);
          resizedTables.add(table);
          notifyChange();
        };

        window.addEventListener('pointermove', onPointerMove);
        window.addEventListener('pointerup', finishDrag);
        window.addEventListener('pointercancel', finishDrag);
      };

      const onDoubleClick = (e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        th.style.width = '';
        th.style.minWidth = '';
        const anyRemaining = headers.some((cell) => Boolean(cell.style.width));
        if (!anyRemaining) {
          table.style.tableLayout = '';
          table.style.width = '';
          resizedTables.delete(table);
          notifyChange();
        }
      };

      handle.addEventListener('pointerdown', onPointerDown);
      handle.addEventListener('dblclick', onDoubleClick);
      th.appendChild(handle);

      activeCleanupFns.push(() => {
        handle.removeEventListener('pointerdown', onPointerDown);
        handle.removeEventListener('dblclick', onDoubleClick);
        handle.remove();
      });
    });
  };

  const scanTables = () => {
    const tables = Array.from(rootEl.querySelectorAll('table'));
    tables.forEach((tbl) => enhanceTable(tbl));
  };

  scanTables();

  const observer = new MutationObserver(() => {
    scanTables();
  });
  observer.observe(rootEl, { childList: true, subtree: true });

  const resetAllWidths = () => {
    resizedTables.forEach((table) => {
      table.style.tableLayout = '';
      table.style.width = '';
      const ths = Array.from(table.querySelectorAll('thead th')) as HTMLTableCellElement[];
      ths.forEach((cell) => {
        cell.style.width = '';
        cell.style.minWidth = '';
      });
    });
    resizedTables.clear();
    notifyChange();
  };

  const cleanup = () => {
    observer.disconnect();
    activeCleanupFns.forEach((fn) => fn());
    activeCleanupFns.length = 0;
    const enhancedTables = Array.from(rootEl.querySelectorAll('table[data-col-resize-enhanced="true"]')) as HTMLTableElement[];
    enhancedTables.forEach((t) => {
      delete t.dataset.colResizeEnhanced;
    });
    document.body.classList.remove('is-col-resizing');
  };

  return { resetAllWidths, cleanup };
}
