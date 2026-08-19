import { EditorView } from "@codemirror/view";

/**
 * Cosmetic-only theme for the sticky bar.
 *
 * ALL sizing (height, lineHeight, padding, overflow, position, display,
 * transform) is set via inline style by plugin.ts — matching Monaco's exact
 * approach of updating styles imperatively on every scroll event.
 *
 * This file only provides:
 *  1. Background color fallback (JS overrides immediately with actual editor bg)
 *  2. Current-scope highlight
 *  3. Gutter cosmetics (color, opacity)
 *  4. Dark-mode override for background fallback
 *
 * ⛔ Do NOT add: height, lineHeight, overflow, display, padding, margin,
 *    position, transform to .cm-stickyscroll-line or .cm-stickyscroll-inner.
 *    Plugin.ts owns those — any CSS here will conflict.
 * ⛔ Do NOT add syntaxHighlighting — token colors come from the consumer's theme.
 */
export const stickyScrollBaseTheme = EditorView.baseTheme({
  // Container background fallback — JS overrides with exact editor color.
  ".cm-stickyscroll-container": {
    backgroundColor: "var(--cm-stickyscroll-bg, #ffffff)",
    color: "inherit",
    font: "inherit",
    fontFamily: "monospace",
    tabSize: "4",
  },

  "&dark .cm-stickyscroll-container": {
    backgroundColor: "var(--cm-stickyscroll-bg, #1e1e1e)",
  },

  // The inner wrapper and every row inherit the container's (opaque) background.
  // This is what makes the VSCode slide-away work: when the innermost row slides
  // up underneath the row above it, the row above is opaque and actually *hides*
  // it — otherwise the sliding row's text would bleed through the outer rows.
  ".cm-stickyscroll-inner": {
    backgroundColor: "inherit",
  },

  ".cm-stickyscroll-line": {
    backgroundColor: "inherit",
  },

  ".cm-stickyscroll-line:hover": {
    backgroundImage: "linear-gradient(var(--cm-stickyscroll-hoverBg, rgba(128,128,128,0.09)), var(--cm-stickyscroll-hoverBg, rgba(128,128,128,0.09)))",
  },

  // Current scope indicator (left accent bar — same as VSCode).
  ".cm-stickyscroll-line.cm-stickyscroll-current": {
    backgroundColor: "inherit",
    backgroundImage: "linear-gradient(var(--cm-stickyscroll-currentBg, rgba(128,128,128,0.07)), var(--cm-stickyscroll-currentBg, rgba(128,128,128,0.07)))",
    boxShadow: "inset 3px 0 0 var(--cm-stickyscroll-accent, #4b9edd)",
  },

  ".cm-stickyscroll-line.cm-stickyscroll-current:hover": {
    backgroundImage: "linear-gradient(var(--cm-stickyscroll-hoverBg, rgba(128,128,128,0.09)), var(--cm-stickyscroll-hoverBg, rgba(128,128,128,0.09)))",
  },

  // Gutter cosmetics — position/size are inline from plugin.ts.
  ".cm-stickyscroll-gutter": {
    color: "var(--cm-stickyscroll-lineNumber, inherit)",
    opacity: "0.55",
    font: "inherit",
    fontSize: "inherit",
  },
});