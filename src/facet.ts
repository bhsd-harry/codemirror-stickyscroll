import { Facet } from "@codemirror/state";
import type { HighlightStyle } from "@codemirror/language";

/**
 * Public options accepted by `stickyScroll()`.
 *
 * All fields are optional; defaults are documented below.
 */
export interface StickyScrollOptions {
  /** Maximum sticky lines shown at once. Default: 4 */
  maxStickyLines?: number;
  /** Minimum number of lines a scope must span before it becomes sticky. Default: 2 */
  minBlockLines?: number;
  /**
   * Denylist predicate. When it returns `true` for a foldable syntax node,
   * that node is never turned into a sticky line, although it could be folded.
   * Defaults to `defaultExcludeNode`, which excludes imports and data
   * literals — exact node names for JS/TS, best-effort name-pattern
   * matching for other grammars. Override for fine-tuning, especially for
   * a specific non-JS/TS language.
   */
  excludeNode?: (nodeName: string, langName: string | undefined) => boolean;
  /**
   * Extra HighlightStyle re-used when a sticky line has to be re-highlighted
   * from scratch (opening line too far above the viewport to clone from the DOM).
   * The active highlighters of the consumer's state are always used first:
   * this option only *adds* classes. If not provided, only the consumer's
   * active highlighters are used.
   */
  highlightStyle?: HighlightStyle;
  /** Called after a sticky line is clicked and the jump has been dispatched. */
  onLineClick?: (lineNumber: number) => void;
  /** Extra CSS class(es) applied to the sticky bar container. */
  class?: string;
}

/** Resolved configuration produced by `stickyScrollFacet`. */
export interface StickyScrollConfig
  extends Required<Pick<StickyScrollOptions, "maxStickyLines" | "minBlockLines" | "excludeNode">> {
  highlightStyle?: HighlightStyle | undefined;
  onLineClick?: ((lineNumber: number) => void) | undefined;
  class?: string | undefined;
}

/**
 * Exact node names we know for certain, verified against the JS/TS Lezer
 * grammar (`@codemirror/lang-javascript`). Kept as an explicit set (rather
 * than folded into the pattern fallback below) because these are the names
 * we can vouch for precisely.
 */
const JS_TS_DENYLIST = new Set([
  "ImportDeclaration",
  "ImportStatement",
  "ObjectExpression",
  "ObjectLiteral",
  "ArrayExpression",
  "ArrayLiteral",
  "ObjectPattern",
  "Comment",
  "LineComment",
  "BlockComment",
  "DocComment",
]);

/**
 * Best-effort fallback for grammars we don't special-case above (Python,
 * Rust, Go, CSS, ...). Every Lezer grammar names its nodes independently, so
 * there is no single exact list that covers all of them — but most `lang-*`
 * packages follow a similar naming convention for the three categories that
 * matter here (data literals, comments, import/use declarations). These
 * patterns catch that convention on a best-effort basis; they will not be
 * 100% precise for every language, but they degrade gracefully (a miss just
 * means the node isn't excluded, not a crash or a wrong result elsewhere).
 * For languages where precision matters, pass a language-specific
 * `excludeNode` via `StickyScrollOptions`.
 */
const LITERAL_NODE_PATTERN = /^(?:Object|Array|List|Dict(?:ionary)?|Set|Record|Map|Tuple)(?:Expression|Literal|Pattern)?$/;
const IMPORT_NODE_PATTERN = /^(?:Import|Use)(?:Declaration|Statement|Item|Spec)?$/;

/**
 * Default denylist (see §4.3 of the design doc): nodes that *are* foldable but
 * semantically are not navigation scopes worth pinning (imports, big data
 * literals, comment blocks).
 *
 * Precise for JS/TS out of the box (`JS_TS_DENYLIST`); best-effort pattern
 * match for everything else. Override via `StickyScrollOptions.excludeNode`
 * for a language you need exact behavior on.
 */
export const defaultExcludeNode = (nodeName: string, langName?: string): boolean => {
  // In pure data languages like JSON, we DO NOT exclude objects/arrays.
  // Because the entire JSON file consists of Objects/Arrays, excluding them
  // would completely disable sticky scroll for the file.
  if (langName === "json") {
    return nodeName.endsWith("Comment");
  }

  if (JS_TS_DENYLIST.has(nodeName)) return true;
  return (
    LITERAL_NODE_PATTERN.test(nodeName) ||
    nodeName.endsWith("Comment") ||
    IMPORT_NODE_PATTERN.test(nodeName)
  );
};

const DEFAULT_MAX_STICKY_LINES = 4;
const DEFAULT_MIN_BLOCK_LINES = 2;

/** Merge partial options with built-in defaults. */
export function makeStickyScrollConfig(options: StickyScrollOptions | undefined): StickyScrollConfig {
  return {
    maxStickyLines: options?.maxStickyLines ?? DEFAULT_MAX_STICKY_LINES,
    minBlockLines: options?.minBlockLines ?? DEFAULT_MIN_BLOCK_LINES,
    excludeNode: options?.excludeNode ?? defaultExcludeNode,
    highlightStyle: options?.highlightStyle,
    onLineClick: options?.onLineClick,
    class: options?.class,
  };
}

/**
 * The facet carrying the sticky-scroll configuration.
 *
 * Multiple `stickyScroll()` instances compose; the *last* registered value wins
 * (override semantics). Consumers may always read/override it per-instance via
 * `stickyScrollFacet.of(...)`.
 */
export const stickyScrollFacet = Facet.define<StickyScrollOptions, StickyScrollConfig>({
  compare: (a, b) => a === b,
  combine: (values) => makeStickyScrollConfig(values[values.length - 1]),
});