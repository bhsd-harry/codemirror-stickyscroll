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
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    overflow: "hidden",
    boxSizing: "border-box",
    fontFamily: "monospace",
    tabSize: 4,
    borderBottom: "1px solid rgba(128,128,128,.2)",
    boxShadow: "0 2px 4px var(--cm-stickyscroll-shadow)",
  },

  "&light .cm-stickyscroll-container": {
    "--cm-stickyscroll-shadow": "rgba(0,0,0,.12)",
  },

  "&dark .cm-stickyscroll-container": {
    "--cm-stickyscroll-shadow": "rgba(255,255,255,.12)",
  },

  ".cm-stickyscroll-line": {
    position: "relative",
    overflow: "hidden",
    whiteSpace: "pre",
    boxSizing: "border-box",
    cursor: "pointer",

    // Current scope indicator (left accent bar — same as VSCode).
    "&.cm-stickyscroll-current": {
      backgroundColor: "rgba(128,128,128,.07)",
      boxShadow: "inset 3px 0 0 #4b9edd",
    },

    "&:hover": {
      backgroundColor: "rgba(128,128,128,.09)",
    },
  },

  // Gutter cosmetics — position/size are inline from plugin.ts.
  ".cm-stickyscroll-gutter": {
    position: "absolute",
    top: 0,
    insetInlineStart: 0,
    zIndex: 1,
    display: "flex",
    alignItems: "stretch",
    boxSizing: "border-box",
    WebkitUserSelect: "none",
    userSelect: "none",
    borderInlineEnd: "1px solid rgba(128,128,128,.18)",
    opacity: 0.55,

    "&>.cm-gutter": {
      flex: "none",
      alignItems: "center",
      justifyContent: "center",
    },

    "& .cm-lineNumbers": {
      order: -1,
    },

    // We provide base flex styles so the number aligns correctly, but allow custom padding to apply via CSS.
    "& .cm-gutterElement": {
      width: "100%",
      boxSizing: "border-box",
      display: "flex",
      alignItems: "center",
      justifyContent: "flex-end",
    },
  },

  ".cm-stickyscroll-code": {
    padding: "0 2px 0 6px",
  },
});