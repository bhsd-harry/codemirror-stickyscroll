import { language, syntaxTree } from "@codemirror/language";
import { Direction, EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { getStickyContext } from "./compute";
import { stickyScrollFacet, type StickyScrollConfig } from "./facet";
import { renderLineCode, type RowCache } from "./render";
import type { StickyLine } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Alpha channel of a computed `background-color`, or `null` when the color has
 * no alpha channel (hex / named / `rgb(...)` → fully opaque).
 */
function alphaOf(bg: string): number {
  if (!bg || bg === "transparent") return 0;
  const m = /rgba?\(([^)]*)\)/.exec(bg);
  if (!m) return 1;
  const parts = m[1]!.split(",");
  if (parts.length === 4) {
    const a = parseFloat(parts[3]!);
    return Number.isNaN(a) ? 1 : a;
  }
  return 1;
}

interface GutterColumnMetrics {
  /** Width of the gutter column in px. */
  width: number;
  /** Original class name(s) of the gutter column element. */
  className: string;
}

interface GutterMetrics {
  /** Total width of .cm-gutters — used for row paddingLeft and gutter overlay width. */
  totalWidth: number;
  /**
   * Width of each individual gutter column (left→right order).
   * CM6 gutter columns are direct children of .cm-gutters.
   * Example: [lineNumbers.offsetWidth, foldGutter.offsetWidth]
   */
  columns: GutterColumnMetrics[];
}

function measureGutters(view: EditorView): GutterMetrics {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  const guttersEl = view.dom.querySelector(".cm-gutters") as HTMLElement | null;
  if (!guttersEl) return { totalWidth: 0, columns: [] };

  const totalWidth = guttersEl.offsetWidth;
  const columns: GutterColumnMetrics[] = Array.from(guttersEl.children as Iterable<HTMLElement>, (child) => ({
    width: child.offsetWidth,
    className: child.className
  }));
  return { totalWidth, columns };
}

// ─────────────────────────────────────────────────────────────────────────────
// VSCode/Monaco-style sticky scroll implementation
//
// Reference: stickyScrollWidget.ts + stickyScrollController.ts
//
//  State has two key values:
//    • startLineNumbers[]     — the N sticky lines to show (outermost → innermost)
//    • lastLineRelativePosition — NEGATIVE in VSCode; how many px the LAST
//                                 (innermost) line has been pushed UP by the
//                                 approaching section break. Range (−lineHeight, 0].
//
//  DOM layout (widget):
//    rootDomNode (.sticky-widget)          overflow:hidden; height set per-frame
//      sticky-widget-lines                 the rows, absolutely positioned
//        row × N                           each row has an explicit `top`
// ─────────────────────────────────────────────────────────────────────────────

class StickyScrollPlugin {
  private readonly dom: HTMLDivElement; // outer container — clips
  private readonly inner: HTMLDivElement; // inner wrapper — holds the rows
  private readonly view: EditorView;
  private config: StickyScrollConfig;

  private readonly cache: RowCache = new Map();

  private rafHandle: number | null = null;
  private observer: ResizeObserver | null = null;
  private gutterObserver: ResizeObserver | null = null;
  private gutterMutationObserver: MutationObserver | null = null;

  private gutterMetrics: GutterMetrics = { totalWidth: 0, columns: [] };
  private currentHeight = 0;
  private lastLineKey = "";

  get lineHeight(): number {
    return Math.round(this.view.defaultLineHeight) || 16;
  }

  constructor(view: EditorView) {
    this.view = view;
    this.config = view.state.facet(stickyScrollFacet);

    // Outer container — clips content, fixed at top of editor.
    this.dom = document.createElement("div");
    this.dom.className =
      "cm-stickyscroll-container" +
      (this.config.class ? ` ${this.config.class}` : "");

    // Inner wrapper — holds the rows; each row is laid out in normal flow and
    // the container clips at its bottom edge (VSCode slide-away).
    this.inner = document.createElement("div");
    this.inner.className = "cm-stickyscroll-inner";

    this.dom.appendChild(this.inner);
    view.dom.appendChild(this.dom);

    view.scrollDOM.addEventListener("scroll", this.onScroll, { passive: true });

    this.observer = new ResizeObserver(this.onScroll);
    this.observer.observe(view.dom);
    const gutterEl = view.dom.querySelector(".cm-gutters");
    if (gutterEl) {
      this.gutterObserver = new ResizeObserver(this.onScroll);
      this.gutterObserver.observe(gutterEl);

      this.gutterMutationObserver = new MutationObserver(() => {
        this.clearCache();
        this.request();
      });
      this.gutterMutationObserver.observe(gutterEl, { childList: true });
    }

    this.request();
  }

  clearCache() {
    this.cache.clear();
    this.lastLineKey = "";
  }

  update(update: ViewUpdate) {
    const configChanged =
      update.state.facet(stickyScrollFacet) !== update.startState.facet(stickyScrollFacet);
    this.config = update.state.facet(stickyScrollFacet);

    const contentChanged = configChanged ||
      update.docChanged ||
      syntaxTree(update.startState) !== syntaxTree(update.state);

    if (contentChanged) {
      this.clearCache();
    }

    if (
      contentChanged ||
      update.viewportChanged ||
      update.geometryChanged ||
      update.selectionSet ||
      update.startState.facet(language) !== update.state.facet(language)
    ) {
      this.request();
    }
  }

  destroy() {
    if (this.rafHandle !== null) cancelAnimationFrame(this.rafHandle);
    this.view.scrollDOM.removeEventListener("scroll", this.onScroll);
    this.observer?.disconnect();
    this.gutterObserver?.disconnect();
    this.dom.remove();
    this.cache.clear();
  }

  private onScroll = () => this.request();

  private request() {
    if (this.rafHandle !== null) return;
    this.rafHandle = requestAnimationFrame(() => {
      try {
        this.render();
      } catch (e) {
        console.warn("[codemirror-stickyscroll]", e);
      }
      this.rafHandle = null;
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Main render — called every animation frame on scroll
  // ─────────────────────────────────────────────────────────────────────────

  private render() {
    const view = this.view;

    // ── Measure ─────────────────────────────────────────────────────────────
    this.gutterMetrics = measureGutters(view);

    // ── Background (match active theme) ─────────────────────────────────────
    // Always opaque (Monaco's sticky widget never lets the code show through).
    this.dom.style.backgroundColor = this.resolveBackground();

    // ── Compute sticky context ───────────────────────────────────────────────
    const lines = getStickyContext(view, this.config);
    if (!lines.length) {
      this.hide();
      return;
    }

    // ── Rebuild rows when line-set changes ───────────────────────────────────
    const lineKey = lines.map((l) => l.lineNumber).join("|");
    if (lineKey !== this.lastLineKey) {
      this.lastLineKey = lineKey;
      this.buildRows(lines);
    }

    const lh = this.lineHeight;
    const totalLines = lines.length;

    // ── Apply layout math ────────────────────────────────────────────────────
    //
    // The container clips via overflow:hidden; we never translate the whole
    // stack — that would make the OUTERMOST line disappear first, unlike VSCode.

    const containerHeight = totalLines * lh;
    this.currentHeight = containerHeight;

    this.dom.style.height = `${containerHeight}px`;
    this.dom.style.display = "";

    // Apply per-frame row attributes (gutter metrics, scrollLeft and highlight).
    this.updateRowAttrs(lines);
    this.dom.dir = view.textDirection === Direction.RTL ? "rtl" : "ltr";

    this.inner.style.lineHeight = `${lh}px`;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // DOM management
  // ─────────────────────────────────────────────────────────────────────────

  private hide() {
    this.dom.style.display = "none";
    this.currentHeight = 0;
    // Do NOT clear this.inner — keep rows for fast reuse on next show.
  }

  /**
   * Rebuild all row DOM nodes (called only when line numbers change).
   * We clear the inner wrapper and build fresh — no stale DOM element issues.
   */
  private buildRows(lines: StickyLine[]) {
    this.inner.textContent = ""; // Remove all children cleanly

    for (const line of lines) {
      this.inner.appendChild(this.makeRow(line));
    }
  }

  /**
   * Update per-frame attributes WITHOUT rebuilding DOM.
   * Called every frame when the line-set is unchanged.
   */
  private updateRowAttrs(
    lines: StickyLine[],
  ) {
    const gm = this.gutterMetrics;
    const rowEls = this.inner.children;

    for (let i = 0; i < lines.length && i < rowEls.length; i++) {
      const line = lines[i]!;
      const row = rowEls[i] as HTMLDivElement;

      this.setHeight(row);
      this.setClass(row, line);

      const gutter = row.firstElementChild as HTMLDivElement;
      this.setWidth(row, gutter);
      this.setHeight(gutter);

      const cols = gutter.children;
      for (let c = 0; c < gm.columns.length && c < cols.length; c++) {
        (cols[c] as HTMLDivElement).style.width = `${gm.columns[c]!.width}px`;
      }

      const code = row.lastElementChild as HTMLDivElement;
      this.setTransform(code);
    }
  }

  /**
   * Build a single sticky row element.
   *
   * The gutter overlay mirrors the real editor gutter column-by-column:
   *   .cm-stickyscroll-gutter  (position:absolute, width = total gutter width)
   */
  private makeRow(
    line: StickyLine,
  ): HTMLDivElement {
    const view = this.view;
    const gm = this.gutterMetrics;

    // Row
    const row = document.createElement("div");
    row.className = "cm-stickyscroll-line";
    this.setClass(row, line);
    row.setAttribute("role", "button");
    row.setAttribute("tabindex", "0");
    row.setAttribute("aria-label", `Go to line ${line.lineNumber}`);
    this.setHeight(row);

    // Gutter overlay container
    const gutter = document.createElement("div");
    gutter.className = "cm-stickyscroll-gutter";
    this.setWidth(row, gutter);
    this.setHeight(gutter);

    if (gm.columns.length) {
      gm.columns.forEach((colMetrics) => {
        const col = document.createElement("div");
        // Reuse the exact same classes so any custom user CSS (like Notron's .cm-lineNumbers .cm-gutterElement) matches!
        col.className = colMetrics.className;
        col.style.width = `${colMetrics.width}px`;

        if (colMetrics.className.includes("cm-lineNumbers")) {
          // Wrap in cm-gutterElement to perfectly match the DOM structure of CM6's line numbers.
          const el = document.createElement("div");
          el.className = "cm-gutterElement";
          el.textContent = String(line.lineNumber);
          col.appendChild(el);
        }
        gutter.appendChild(col);
      });
    }

    // Code span
    const code = renderLineCode(view, line, this.cache);
    this.setTransform(code);

    row.appendChild(gutter);
    row.appendChild(code);

    // Click / keyboard
    const jump = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      view.dispatch({
        selection: { anchor: line.from },
        effects: EditorView.scrollIntoView(line.from, {
          y: "start",
          yMargin: this.currentHeight + 4,
        }),
      });
      view.focus();
    };
    row.addEventListener("click", jump);
    row.addEventListener("keydown", (ev: KeyboardEvent) => {
      if (ev.key === "Enter" || ev.key === " ") jump(ev);
    });

    return row;
  }

  setClass(row: HTMLDivElement, line: StickyLine) {
    const head = this.view.state.selection.main.head;
    row.classList.toggle(
      "cm-stickyscroll-current",
      head >= line.nodeFrom && head <= line.nodeTo
    );
  }

  setWidth(row: HTMLDivElement, gutter: HTMLDivElement) {
    const gw = this.gutterMetrics.totalWidth;
    row.style.paddingInlineStart = `${gw}px`;
    gutter.style.width = `${gw}px`;
  }

  setHeight(ele: HTMLDivElement) {
    const lh = this.lineHeight;
    ele.style.height = `${lh}px`;
  }

  setTransform(code: HTMLDivElement) {
    const scrollX = this.view.scrollDOM.scrollLeft;
    code.style.transform = scrollX > 0 ? `translateX(${-scrollX}px)` : "";
  }

  /**
   * Resolve the sticky bar's background to a GUARANTEED-opaque color that
   * matches the editor's effective backdrop.
   *
   *   1. Walk the real ancestor chain (contentDOM → … → <html>) and return the
   *      first opaque color, skipping fully transparent AND semi-transparent
   *      layers (a semi-transparent ancestor is only used as a last resort).
   *   2. Fall back to a dark/light hex default.
   *
   * This makes it impossible for the sticky bar to end up see-through, exactly
   * like Monaco's sticky widget which always paints a solid background.
   */
  private resolveBackground(): string {
    const detected = this.detectBg();
    if (detected) return detected;

    const isDark = this.view.dom.classList.contains("cm-dark");
    return isDark ? "#1e1e1e" : "#fff";
  }

  private detectBg(): string | null {
    let semiTransparent: string | null = null;
    let el: HTMLElement | null = this.view.contentDOM;
    while (el) {
      const bg = getComputedStyle(el).backgroundColor;
      const alpha = alphaOf(bg);
      if (alpha > 0) {
        if (alpha >= 1) return bg;
        semiTransparent = semiTransparent || bg;
      }
      el = el.parentElement;
    }
    return semiTransparent;
  }
}

export const scrollStickyPlugin = ViewPlugin.fromClass(StickyScrollPlugin, {});