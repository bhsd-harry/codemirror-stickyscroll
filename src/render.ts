import type { Language } from "@codemirror/language";
import { highlightingFor, language } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import type { NodeType } from "@lezer/common";
import { highlightTree, type Highlighter, type Tag } from "@lezer/highlight";
import { syntaxTree } from "@codemirror/language";
import type { StickyScrollConfig } from "./facet";
import type { StickyLine } from "./types";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Cache of rendered code elements keyed by opening line number. */
export type RowCache = Map<number, { text: string; el: HTMLElement }>;

// ---------------------------------------------------------------------------
// Internal: consumer-theme-aware Highlighter
// ---------------------------------------------------------------------------

/**
 * Resolves highlight classes from the *active* styles in the consumer's
 * EditorState (§4.4) — not from any palette bundled with this package.
 */
class StateHighlighter implements Highlighter {
  constructor(readonly state: EditorState, readonly topNodeType: NodeType) {}

  style(tags: readonly Tag[]): string | null {
    return highlightingFor(this.state, tags, this.topNodeType);
  }

  scope(): boolean {
    return true;
  }
}

// ---------------------------------------------------------------------------
// Internal: find the live `.cm-line` DOM element for a document line
// ---------------------------------------------------------------------------

function findRenderedLineElement(view: EditorView, lineNumber: number): HTMLElement | null {
  const lineFrom = view.state.doc.line(lineNumber).from;
  // Only lines that are actually rendered in the DOM can be cloned. Anything
  // outside `view.viewport` (visible area + render margin) must fall back to
  // re-highlighting, never to a position-clamped lookup.
  if (lineFrom < view.viewport.from || lineFrom > view.viewport.to) return null;

  // `domAtPos` maps a document position to its exact DOM node, so it is immune
  // to index misalignment between `viewportLineBlocks` and `querySelectorAll`.
  // (Block widgets, placeholder lines and render-margin lines make those two
  // lists diverge, which previously caused wrong — blank / comment / `}` —
  // line text to be cloned into the sticky bar.)
  let dom: { node: Node; offset: number } | null = null;
  try {
    dom = view.domAtPos(lineFrom, 1);
  } catch {
    return null;
  }

  let el = dom.node instanceof HTMLElement ? dom.node : dom.node.parentElement;
  while (el && !el.classList.contains("cm-line")) el = el.parentElement;
  return el;
}

// ---------------------------------------------------------------------------
// Internal: remove leading closing brace '}' for aesthetic VS Code parity
// ---------------------------------------------------------------------------

function removeLeadingClosingBrace(el: HTMLElement) {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
  let node: Node | null;
  while (node = walker.nextNode()) {
    const text = node.nodeValue || "";
    if (text.trim() === "") continue;

    const match = /^(\s*)\}\s*(?!\s)(.*)$/.exec(text);
    if (match) {
      node.nodeValue = match[1]! + match[2]!;
      return;
    }
    break; // Hit a non-whitespace character that isn't '}'
  }
}

// ---------------------------------------------------------------------------
// Public: renderLineCode
// ---------------------------------------------------------------------------

/**
 * Build (or return cached) a `<span class="cm-stickyscroll-code">` element
 * containing the syntax-highlighted code for one opening line (§4.4 / §4.6b).
 *
 * Priority:
 *  1. Deep-clone the live CM6 `.cm-line` element when it is in the viewport —
 *     token classes (`.tok-*`) are reused verbatim, guaranteed theme-accurate.
 *  2. Re-highlight via the consumer's active `HighlightStyle`(s) using
 *     `highlightingFor()` — never our own color palette.
 *  3. Plain-text fallback (leading whitespace/indentation preserved).
 *
 * Results are cached by `(lineNumber, text)` so unchanged lines are free.
 * The cache must be cleared externally when the syntax tree or config changes.
 */
export function renderLineCode(
  view: EditorView,
  line: StickyLine,
  config: StickyScrollConfig,
  cache: RowCache
): HTMLElement {
  // Cache hit.
  const hit = cache.get(line.lineNumber);
  if (hit && hit.text === line.text) return hit.el;

  const makeSpan = (child?: Node): HTMLElement => {
    const s = document.createElement("span");
    s.className = "cm-stickyscroll-code";
    if (child) s.appendChild(child);
    else s.textContent = line.text; // plain text, indentation preserved
    return s;
  };

  // ── Strategy 1: clone the live viewport DOM line ─────────────────────────
  const rendered = findRenderedLineElement(view, line.lineNumber);
  // Ensure we don't clone empty virtual DOM placeholders that CM uses during fast scrolls.
  if (rendered && rendered.textContent !== "") {
    const frag = document.createDocumentFragment();
    for (const child of rendered.childNodes) {
      frag.appendChild(child.cloneNode(true));
    }
    const el = makeSpan(frag);
    removeLeadingClosingBrace(el);
    cache.set(line.lineNumber, { text: line.text, el });
    return el;
  }

  // ── Strategy 2: re-highlight from the consumer's active HighlightStyle(s) ─
  const lang: Language | null = view.state.facet(language);
  if (lang) {
    try {
      const tree = syntaxTree(view.state);
      const topType: NodeType = tree.type;
      const highlighters: readonly Highlighter[] = config.highlightStyle
        ? [new StateHighlighter(view.state, topType), config.highlightStyle]
        : [new StateHighlighter(view.state, topType)];

      const out = document.createElement("span");
      out.className = "cm-stickyscroll-code";
      let last = line.from;

      highlightTree(
        tree,
        highlighters,
        (from, to, cls) => {
          const start = Math.max(last, from);
          const end = Math.min(line.to, to);
          if (start >= end) return;

          if (start > last) {
            out.appendChild(
              document.createTextNode(line.text.slice(last - line.from, start - line.from))
            );
          }
          if (cls) {
            const tok = document.createElement("span");
            tok.className = cls;
            tok.textContent = line.text.slice(start - line.from, end - line.from);
            out.appendChild(tok);
          } else {
            out.appendChild(
              document.createTextNode(line.text.slice(start - line.from, end - line.from))
            );
          }
          last = end;
        },
        line.from,
        line.to
      );

      // Trailing unstyled text.
      if (last < line.to) {
        out.appendChild(document.createTextNode(line.text.slice(last - line.from)));
      }

      // Only cache when we produced actual content.
      if (out.childNodes.length > 0) {
        removeLeadingClosingBrace(out);
        cache.set(line.lineNumber, { text: line.text, el: out });
        return out;
      }
    } catch {
      // Fall through to plain text.
    }
  }

  // ── Strategy 3: plain text ────────────────────────────────────────────────
  const el = makeSpan();
  removeLeadingClosingBrace(el);
  cache.set(line.lineNumber, { text: line.text, el });
  return el;
}