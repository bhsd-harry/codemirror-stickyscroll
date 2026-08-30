import type { EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import type { SyntaxNode, Tree } from "@lezer/common";
import { ensureSyntaxTree, foldNodeProp, foldService, language, syntaxTree } from "@codemirror/language";
import type { StickyScrollConfig } from "./facet";
import type { StickyLine } from "./types";

/**
 * Milliseconds of synchronous parse work we are allowed to spend per sticky
 * update when the committed syntax tree has not caught up with the viewport
 * yet (large files / big scroll jumps). The background parser keeps working
 * between frames and commits its results, so this only accelerates the first
 * reveal; once the tree covers the position the cost is O(1).
 */
const PARSE_TIMEOUT = 25;

/**
 * Maximum number of lines to scan for foldable blocks when any fold service is
 * registered.
 */
const MAX_SERVICE_SCAN_LINES = 100;

/**
 * Return the best syntax tree we can answer a query at `pos` with right now.
 *
 * When the committed tree already covers `pos`, it is used directly (cheap).
 * Otherwise we synchronously advance the parser for a bounded amount of time
 * and use the extended tree if it reached `pos`, falling back to the committed
 * tree otherwise (the background parser commits the rest shortly after).
 *
 * This is what keeps the sticky bar correct on files with thousands of lines:
 * without it, `syntaxTree(state)` still holds a stale, short parse right after
 * a scroll jump, and the ancestor walk would clamp to the document root and
 * return no sticky lines at all.
 */
function treeUpTo(state: EditorState, pos: number): Tree {
  const committed = syntaxTree(state);
  if (committed.length >= pos) return committed;
  return ensureSyntaxTree(state, pos, PARSE_TIMEOUT) ?? committed;
}

/**
 * Compute the sticky context for the current scroll position (viewport top).
 */
export function getStickyContext(view: EditorView, config: StickyScrollConfig): StickyLine[] {
  const state = view.state;
  const lang = state.facet(language);
  if (!lang) return [];
  const tree = syntaxTree(state);
  if (tree.length === 0) return [];

  // Calculate the document-relative Y of the top edge of the visible viewport.
  // `view.documentTop` is the client Y of the document's top edge.
  // The viewport's top client Y is `scrollDOM.getBoundingClientRect().top`.
  const clientTop = view.scrollDOM.getBoundingClientRect().top;
  let y = clientTop - view.documentTop;
  if (y < 0) y = 0;

  const topBlock = view.lineBlockAtHeight(y);
  if (topBlock.from > state.doc.length) return [];

  // Make sure the parser has covered at least the whole rendered range before
  // walking ancestors, so deeply-scrolled positions in big files resolve to
  // real scopes instead of the (clamped) document root.
  const upto = Math.min(view.viewport.to, state.doc.length);
  const parseTree = treeUpTo(state, upto);

  // Dynamic clamp: limit sticky bar to max ~40% of the editor height
  const lineHeight = Math.round(view.defaultLineHeight) || 16;
  const maxDynamic = Math.max(1, Math.floor(view.scrollDOM.clientHeight * 0.4 / lineHeight));
  const maxSticky = Math.min(config.maxStickyLines, maxDynamic);

  return getStickyContextForRange(state, topBlock.from, config, parseTree, maxSticky);
}

/**
 * Pure version of the algorithm.
 *
 * `tree` is optional and defaults to the committed syntax tree; pass an
 * already-extended tree (see `getStickyContext`) to compute against a parse
 * that is known to cover `fromPos`.
 */
function getStickyContextForRange(
  state: EditorState,
  fromPos: number,
  config: StickyScrollConfig,
  t: Tree,
  maxSticky: number
): StickyLine[] {
  const lang = state.facet(language);
  if (!lang) return [];

  if (t.length === 0) return [];

  const doc = state.doc;
  if (fromPos > doc.length) return [];
  const topLineNumber = doc.lineAt(fromPos).number;
  const minBlockLines = config.minBlockLines;
  const exclude = config.excludeNode;
  const langName = lang.name;

  const found: StickyLine[] = [];

  const services = state.facet(foldService);
  if (services.length === 0) {
    let node: SyntaxNode | null = t.resolveInner(fromPos, 0);
    while (node) {
      if (!node.type.isTop && node.from < node.to && node.to <= doc.length) {
        const prop = node.type.prop(foldNodeProp);
        if (prop) {
          const foldRange = prop(node, state);
          if (foldRange) {
            // Find the semantic owner of this foldable block
            let owner = node;
            if (node.parent && !node.parent.type.isTop && !node.parent.type.prop(foldNodeProp)) {
              owner = node.parent;
            }

            const open = doc.lineAt(owner.from);
            const openLine = open.number;

            // Opening line must already be scrolled out above the viewport, and must not be blank.
            if (openLine < topLineNumber && open.text.trim() !== "") {
              // The denylist describes *foldable* node types (data literals,
              // comments, imports). `owner` may be a wrapper (e.g.
              // VariableDeclaration wrapping an ObjectExpression), so evaluate
              // against the foldable node's own type name.
              const typeName = node.name;
              if (!exclude(typeName, langName, owner.name)) {
                // A scope only counts as "over" once its full semantic end has
                // passed, so measure from `owner.to` (e.g. the whole try/catch or
                // if/else statement) instead of just the foldable block. This is
                // what delays the slide-away until the real closing brace.
                const close = doc.lineAt(Math.min(owner.to, doc.length));
                const closeLine = close.number;

                if (closeLine - openLine + 1 >= minBlockLines && closeLine >= topLineNumber) {
                  found.push({
                    lineNumber: openLine,
                    from: open.from,
                    to: open.to,
                    text: open.text,
                    nodeFrom: owner.from,
                    nodeTo: owner.to,
                  });
                }
              }
            }
          }
        }
      }
      node = node.parent;
    }
  } else {
    const minLineNumber = Math.max(0, topLineNumber - MAX_SERVICE_SCAN_LINES);
    for (let openLine = topLineNumber - 1; openLine > minLineNumber; openLine--) {
      const open = doc.line(openLine);
      const ownerName = open.text.trim();
      if (!exclude(undefined, langName, ownerName)) {
        for (const service of services) {
          const foldRange = service(state, open.from, open.to);
          if (foldRange) {
            const nodeTo = Math.min(foldRange.to, doc.length);
            const close = doc.lineAt(nodeTo);
            const closeLine = close.number;
            if (closeLine - openLine + 1 >= minBlockLines && closeLine >= topLineNumber) {
              found.push({
                lineNumber: openLine,
                from: open.from,
                to: open.to,
                text: open.text,
                nodeFrom: foldRange.from,
                nodeTo,
              });
            }
          }
        }
      }
    }
  }

  // `found` is collected innermost → outermost. Reverse to outermost → innermost,
  // dedup by opening line (keep the outermost node on that line), then cap.
  found.reverse();

  const dedup = new Map<number, StickyLine>();
  for (const line of found) {
    if (!dedup.has(line.lineNumber)) dedup.set(line.lineNumber, line);
  }

  return Array.from(dedup.values()).slice(0, maxSticky);
}