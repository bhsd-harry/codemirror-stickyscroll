import type { Extension } from "@codemirror/state";
import { stickyScrollFacet, type StickyScrollOptions } from "./facet";
import { scrollStickyPlugin } from "./plugin";
import { stickyScrollBaseTheme } from "./theme";

export type { StickyLine } from "./types";
export type { StickyScrollOptions, StickyScrollConfig } from "./facet";
export { stickyScrollFacet, defaultExcludeNode, makeStickyScrollConfig } from "./facet";
export { stickyScrollBaseTheme } from "./theme";

/**
 * Add Monaco/VS Code-style sticky scroll to a CodeMirror 6 editor.
 *
 * ```ts
 * import { stickyScroll } from "@fazelstudio/codemirror-stickyscroll";
 *
 * const view = new EditorView({
 *   extensions: [basicSetup, javascript(), stickyScroll({ maxStickyLines: 4 })],
 *   parent: el,
 * });
 * ```
 *
 * Note: the returned array deliberately does NOT contain any
 * `syntaxHighlighting(...)` — token colors always come from the consumer's own
 * theme (§4.4).
 */
export function stickyScroll(options: StickyScrollOptions = {}): Extension {
  return [stickyScrollFacet.of(options), stickyScrollBaseTheme, scrollStickyPlugin];
}