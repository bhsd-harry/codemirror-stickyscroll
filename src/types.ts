/**
 * A single sticky breadcrumb row shown in the sticky bar.
 *
 * Each entry describes the *opening line* of a scope block (function, class,
 * if/loop block, ...) whose opening line has scrolled out above the viewport
 * while its closing line is still at/below the viewport.
 */
export interface StickyLine {
  /** 1-based line number of the opening line. */
  lineNumber: number;
  /** Position of the start of the opening line. Used for click-to-jump + selection. */
  from: number;
  /** Position of the end of the opening line. */
  to: number;
  /** Full text of the opening line (leading indentation preserved). */
  text: string;
  /** Start position of the whole foldable scope node (e.g. `function` keyword). */
  nodeFrom: number;
  /** End position of the whole foldable scope node (e.g. closing brace). */
  nodeTo: number;
  /** 1-based document line number where the scope closes (nodeTo). */
  closingLine: number;
}