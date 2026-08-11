import { language, syntaxTree } from "@codemirror/language";
import { Direction, EditorView, ViewPlugin, ViewUpdate } from "@codemirror/view";
import { getStickyContext } from "./compute";
import { stickyScrollFacet, type StickyScrollConfig } from "./facet";
import { renderLineCode, type RowCache } from "./render";
import type { StickyLine } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────────────────

function isTransparent(bg: string): boolean {
  if (!bg || bg === "transparent" || bg === "rgba(0, 0, 0, 0)") return true;
  const m = /rgba?\(([^)]*)\)/.exec(bg);
  if (m) {
    const parts = m[1].split(",");
    if (parts.length === 4 && parseFloat(parts[3].trim()) === 0) return true;
  }
  return false;
}

/**
 * Alpha channel of a computed `background-color`, or `null` when the color has
 * no alpha channel (hex / named / `rgb(...)` → fully opaque).
 */
function alphaOf(bg: string): number | null {
  const m = /rgba?\(([^)]*)\)/.exec(bg);
  if (!m) return null;
  const parts = m[1].split(",");
  if (parts.length === 4) {
    const a = parseFloat(parts[3].trim());
    return Number.isNaN(a) ? null : a;
  }
  return null;
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
  const guttersEl = view.dom.querySelector(".cm-gutters") as HTMLElement | null;
  if (!guttersEl) return { totalWidth: 0, columns: [] };

  const totalWidth = guttersEl.offsetWidth;
  const columns: GutterColumnMetrics[] = [];
  for (const child of Array.from(guttersEl.children) as HTMLElement[]) {
    columns.push({
      width: child.offsetWidth,
      className: child.className
    });
  }
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
//  Slide-away (stickyScrollController.findScrollWidgetState + widget._updatePosition):
//    The innermost sticky line is the one that disappears first. As the BOTTOM
//    of its scope's end line approaches the viewport top, the whole bar's
//    height shrinks from the bottom while the innermost row is pushed up
//    underneath the row above it (lower z-index). Outer rows never move.
//
//  DOM layout (widget):
//    rootDomNode (.sticky-widget)          overflow:hidden; height set per-frame
//      sticky-widget-lines                 the rows, absolutely positioned
//        row × N                           each row has an explicit `top`
//
//  Per-frame math (translating to CodeMirror, offset = −lastLineRelativePosition):
//    • offset            = clamp(totalHeight − (closingLine.bottom − viewportTop), 0, lineHeight)
//    • container height  = totalHeight − offset          (shrinks from the bottom)
//    • innermost row     = translateY(−offset), zIndex 0 (slides up underneath)
//    • outer rows        = unchanged,              zIndex 1 (stay pinned on top)
// ─────────────────────────────────────────────────────────────────────────────

class StickyScrollPlugin {
  private readonly dom: HTMLElement;   // outer container — clips
  private readonly inner: HTMLElement; // inner wrapper — holds the rows
  private readonly view: EditorView;
  private config: StickyScrollConfig;

  private readonly cache: RowCache = new Map();

  private rafHandle: number | null = null;
  private observer: ResizeObserver | null = null;
  private gutterObserver: ResizeObserver | null = null;

  private lineHeight = 16;
  private gutterMetrics: GutterMetrics = { totalWidth: 0, columns: [] };
  private currentHeight = 0;
  private lastLineKey = "";

  constructor(view: EditorView) {
    this.view = view;
    this.config = view.state.facet(stickyScrollFacet);

    // Outer container — clips content, fixed at top of editor.
    this.dom = document.createElement("div");
    this.dom.className =
      "cm-stickyscroll-container" +
      (this.config.class ? ` ${this.config.class}` : "");
    this.dom.style.cssText =
      "position:absolute;top:0;left:0;right:0;z-index:10;" +
      "overflow:hidden;box-sizing:border-box;pointer-events:none;";

    // Inner wrapper — holds the rows; each row is laid out in normal flow and
    // the container clips at its bottom edge (VSCode slide-away).
    this.inner = document.createElement("div");
    this.inner.className = "cm-stickyscroll-inner";
    this.inner.style.cssText = "pointer-events:auto;";

    this.dom.appendChild(this.inner);
    view.dom.appendChild(this.dom);

    view.scrollDOM.addEventListener("scroll", this.onScroll, { passive: true });

    if (typeof ResizeObserver !== "undefined") {
      this.observer = new ResizeObserver(() => this.request());
      this.observer.observe(view.dom);
      const gutterEl = view.dom.querySelector(".cm-gutters");
      if (gutterEl) {
        this.gutterObserver = new ResizeObserver(() => this.request());
        this.gutterObserver.observe(gutterEl);
      }
    }

    this.request();
  }

  update(update: ViewUpdate) {
    const configChanged =
      update.state.facet(stickyScrollFacet) !== update.startState.facet(stickyScrollFacet);
    this.config = update.state.facet(stickyScrollFacet);

    if (
      update.docChanged ||
      configChanged ||
      syntaxTree(update.startState) !== syntaxTree(update.state)
    ) {
      this.cache.clear();
      this.lastLineKey = "";
    }

    if (
      update.docChanged ||
      update.viewportChanged ||
      update.geometryChanged ||
      update.selectionSet ||
      configChanged ||
      update.startState.facet(language) !== update.state.facet(language) ||
      syntaxTree(update.startState) !== syntaxTree(update.state)
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
      this.rafHandle = null;
      try {
        this.render();
      } catch (e) {
        if (typeof console !== "undefined")
          console.warn("[codemirror-stickyscroll]", e);
      }
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Main render — called every animation frame on scroll
  // ─────────────────────────────────────────────────────────────────────────

  private render() {
    const view = this.view;

    // ── Measure ─────────────────────────────────────────────────────────────
    this.lineHeight = Math.round(view.defaultLineHeight) || 16;
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

    // ── VSCode/Monaco-style slide-away ───────────────────────────────────────
    //
    // `slideOffset` ∈ [0, lineHeight) is how far the innermost sticky line has
    // been pushed up so far. It grows as the BOTTOM of the innermost scope's
    // end line rises toward the viewport top. The bar height shrinks from the
    // bottom and only the innermost row slides up (underneath the row above it,
    // applied in updateRowAttrs) — outer rows stay pinned, exactly like VSCode.
    //
    // In VSCode terms: lastLineRelativePosition = −slideOffset, container height
    // = totalHeight − slideOffset, innermost row top = (N−1)·lh − slideOffset.
    const lh = this.lineHeight;
    const totalLines = lines.length;
    const totalHeight = totalLines * lh;

    // viewport top in document-space coordinates
    const scrollTop = view.scrollDOM.scrollTop;
    const docTop = view.documentTop;
    const viewportTopY = Math.max(0, scrollTop - docTop);

    let slideOffset = 0;
    try {
      const innermost = lines[totalLines - 1];
      // The end of the innermost scope. We use the bottom of this line as the
      // reference: once it rises above where the innermost row's bottom sits in
      // the bar (totalHeight from the viewport top), the row starts sliding.
      const safePos = Math.min(innermost.nodeTo, view.state.doc.length - 1);
      if (safePos >= 0) {
        const closingBlock = view.lineBlockAt(safePos);
        const bottomOfEndLine = closingBlock.bottom - viewportTopY;
        slideOffset = Math.max(0, Math.min(lh, totalHeight - bottomOfEndLine));
      }
    } catch {
      // height map not settled — keep slideOffset = 0
    }

    // ── Apply layout math ────────────────────────────────────────────────────
    //
    // VSCode:
    //   containerHeight = totalHeight − slideOffset   (clip from the bottom)
    //   innermost row    pushed up by slideOffset, zIndex 0 (slides underneath)
    //   outer rows       untouched, zIndex 1
    //
    // The container clips via overflow:hidden; we never translate the whole
    // stack — that would make the OUTERMOST line disappear first, unlike VSCode.

    const containerHeight = Math.max(0, totalHeight - slideOffset);
    this.currentHeight = containerHeight;

    this.dom.style.height = `${containerHeight}px`;
    this.dom.style.display = "";

    // Apply per-frame row attributes (gutter metrics, scrollLeft, highlight,
    // and the innermost row's slide-away translate).
    this.updateRowAttrs(lines, view.scrollDOM.scrollLeft, view.state.selection.main.head, slideOffset);
    this.dom.dir = view.textDirection === Direction.RTL ? "rtl" : "ltr";

    // Add border + shadow ONLY when bar has content.
    this.dom.style.borderBottom =
      containerHeight > 0
        ? "1px solid var(--cm-stickyscroll-border, rgba(128,128,128,0.2))"
        : "";
    this.dom.style.boxShadow =
      containerHeight > 0 ? "0 2px 8px rgba(0,0,0,0.12)" : "";
  }

  // ─────────────────────────────────────────────────────────────────────────
  // DOM management
  // ─────────────────────────────────────────────────────────────────────────

  private hide() {
    this.dom.style.height = "0px";
    this.dom.style.display = "none";
    this.dom.style.borderBottom = "";
    this.dom.style.boxShadow = "";
    this.currentHeight = 0;
    // Do NOT clear this.inner — keep rows for fast reuse on next show.
  }

  /**
   * Rebuild all row DOM nodes (called only when line numbers change).
   * We clear the inner wrapper and build fresh — no stale DOM element issues.
   */
  private buildRows(lines: StickyLine[]) {
    const view = this.view;
    const lh = this.lineHeight;
    const gm = this.gutterMetrics;
    const scrollX = view.scrollDOM.scrollLeft;
    const head = view.state.selection.main.head;

    this.inner.textContent = ""; // Remove all children cleanly

    for (const line of lines) {
      this.inner.appendChild(this.makeRow(view, line, lh, gm, scrollX, head));
    }
  }

  /**
   * Update per-frame attributes WITHOUT rebuilding DOM.
   * Called every frame when the line-set is unchanged.
   *
   * `slideOffset` drives the VSCode slide-away: the innermost row is pushed up
   * by `slideOffset` px underneath the outer rows (zIndex 0 < zIndex 1) while
   * the container height shrinks from the bottom.
   */
  private updateRowAttrs(
    lines: StickyLine[],
    scrollX: number,
    head: number,
    slideOffset = 0
  ) {
    const lh = this.lineHeight;
    const gm = this.gutterMetrics;
    const rowEls = this.inner.children;
    const lastIndex = lines.length - 1;

    for (let i = 0; i < lines.length && i < rowEls.length; i++) {
      const line = lines[i];
      const row = rowEls[i] as HTMLElement;

      row.style.height = `${lh}px`;
      row.style.lineHeight = `${lh}px`;
      row.style.paddingLeft = `${gm.totalWidth}px`;
      row.classList.toggle(
        "cm-stickyscroll-current",
        head >= line.nodeFrom && head <= line.nodeTo
      );

      // VSCode stickyScrollWidget._updatePosition: only the innermost row moves
      // (slides up underneath), every outer row stays pinned on top of it.
      if (i === lastIndex) {
        row.style.zIndex = "0";
        row.style.transform =
          slideOffset > 0 ? `translateY(${-slideOffset}px)` : "";
      } else {
        row.style.zIndex = "1";
        row.style.transform = "";
      }

      const gutter = row.firstElementChild as HTMLElement | null;
      if (gutter) {
        gutter.style.width = `${gm.totalWidth}px`;
        gutter.style.height = `${lh}px`;
        gutter.style.lineHeight = `${lh}px`;

        const cols = gutter.children;
        for (let c = 0; c < gm.columns.length && c < cols.length; c++) {
          (cols[c] as HTMLElement).style.width = `${gm.columns[c].width}px`;
        }
      }

      const code = row.lastElementChild as HTMLElement | null;
      if (code) {
        code.style.transform = scrollX > 0 ? `translateX(${-scrollX}px)` : "";
      }
    }
  }

  /**
   * Build a single sticky row element.
   *
   * The gutter overlay mirrors the real editor gutter column-by-column:
   *   .cm-stickyscroll-gutter  (position:absolute, width = total gutter width)
   *     column[0]  ← mirrors .cm-lineNumbers  (shows the line number, right-aligned)
   *     column[1]  ← mirrors .cm-foldGutter   (blank spacer, same width)
   *     column[N]  ← any additional gutter columns
   *
   * This makes the sticky line number align perfectly with the editor's own
   * line numbers, regardless of which gutter extensions are active.
   */
  private makeRow(
    view: EditorView,
    line: StickyLine,
    lh: number,
    gm: GutterMetrics,
    scrollX: number,
    head: number
  ): HTMLElement {
    const gw = gm.totalWidth;

    // Row
    const row = document.createElement("div");
    row.className = "cm-stickyscroll-line";
    if (head >= line.nodeFrom && head <= line.nodeTo) {
      row.classList.add("cm-stickyscroll-current");
    }
    row.setAttribute("role", "button");
    row.setAttribute("tabindex", "0");
    row.title = line.text;
    row.setAttribute("aria-label", `Go to line ${line.lineNumber}`);
    row.style.cssText =
      `height:${lh}px;` +
      `line-height:${lh}px;` +
      `padding-left:${gw}px;` +
      "display:block;position:relative;overflow:hidden;" +
      "white-space:pre;box-sizing:border-box;cursor:pointer;";

    // Gutter overlay container
    const gutter = document.createElement("div");
    gutter.className = "cm-stickyscroll-gutter";
    gutter.style.cssText =
      `width:${gw}px;height:${lh}px;line-height:${lh}px;` +
      "position:absolute;top:0;left:0;z-index:1;" +
      "display:flex;align-items:stretch;box-sizing:border-box;user-select:none;" +
      "background-color:inherit;" +
      "background-image:inherit;" +
      "border-right:1px solid var(--cm-stickyscroll-gutterBorder, rgba(128,128,128,0.18));";

    if (gm.columns.length === 0) {
      const linenum = document.createElement("span");
      linenum.className = "cm-stickyscroll-linenum";
      linenum.textContent = String(line.lineNumber);
      linenum.style.cssText = "display:block;text-align:right;width:100%;white-space:nowrap;font:inherit;padding-right:4px;";
      gutter.appendChild(linenum);
    } else {
      gm.columns.forEach((colMetrics) => {
        const col = document.createElement("div");
        // Reuse the exact same classes so any custom user CSS (like Notron's .cm-lineNumbers .cm-gutterElement) matches!
        col.className = colMetrics.className;
        col.style.cssText = `width:${colMetrics.width}px;flex:none;box-sizing:border-box;display:flex;align-items:center;justify-content:center;`;

        if (colMetrics.className.includes("cm-lineNumbers")) {
          // Wrap in cm-gutterElement to perfectly match the DOM structure of CM6's line numbers.
          const el = document.createElement("div");
          el.className = "cm-gutterElement";
          el.textContent = String(line.lineNumber);
          // We provide base flex styles so the number aligns correctly, but allow custom padding to apply via CSS.
          el.style.cssText = "width:100%;box-sizing:border-box;display:flex;align-items:center;justify-content:flex-end;";
          col.appendChild(el);
        }
        gutter.appendChild(col);
      });
    }

    // Code span
    const code = renderLineCode(view, line, this.config, this.cache);
    code.className = "cm-stickyscroll-code";
    code.style.cssText =
      "display:inline;white-space:pre;" +
      (scrollX > 0 ? `transform:translateX(${-scrollX}px);` : "");

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
      this.config.onLineClick?.(line.lineNumber);
    };
    row.addEventListener("click", jump);
    row.addEventListener("keydown", (ev: KeyboardEvent) => {
      if (ev.key === "Enter" || ev.key === " ") jump(ev);
    });

    return row;
  }

  /**
   * Resolve the sticky bar's background to a GUARANTEED-opaque color that
   * matches the editor's effective backdrop.
   *
   *   1. Walk the real ancestor chain (contentDOM → … → <html>) and return the
   *      first opaque color, skipping fully transparent AND semi-transparent
   *      layers (a semi-transparent ancestor is only used as a last resort).
   *   2. Fall back to the consumer's `--cm-stickyscroll-bg` custom property.
   *   3. Fall back to a dark/light hex default.
   *
   * This makes it impossible for the sticky bar to end up see-through, exactly
   * like Monaco's sticky widget which always paints a solid background.
   */
  private resolveBackground(): string {
    const detected = this.detectBg();
    if (detected) return detected;

    const varBg = this.resolveVarBg();
    if (varBg) return varBg;

    const isDark = this.view.dom.classList.contains("cm-dark");
    return isDark ? "#1e1e1e" : "#ffffff";
  }

  /**
   * Read the consumer-defined `--cm-stickyscroll-bg` if present (else null).
   * Read straight from the container's computed style — no throwaway DOM.
   */
  private resolveVarBg(): string | null {
    try {
      const raw = getComputedStyle(this.dom).getPropertyValue("--cm-stickyscroll-bg").trim();
      if (!raw || isTransparent(raw)) return null;
      return raw;
    } catch {
      return null;
    }
  }

  private detectBg(): string | null {
    let semiTransparent: string | null = null;
    let el: HTMLElement | null = this.view.contentDOM;
    while (el) {
      const bg = getComputedStyle(el).backgroundColor;
      if (!isTransparent(bg)) {
        const alpha = alphaOf(bg);
        if (alpha === null || alpha >= 1) return bg;
        semiTransparent = semiTransparent || bg;
      }
      el = el.parentElement;
    }
    return semiTransparent;
  }
}

export const scrollStickyPlugin = ViewPlugin.fromClass(StickyScrollPlugin, {});