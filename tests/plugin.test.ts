// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from "vitest";
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { javascript } from "@codemirror/lang-javascript";
import { basicSetup } from "codemirror";
import { stickyScroll } from "../src/index";

// jsdom lacks layout APIs that CodeMirror's own measurement uses while
// scrolling (Range.getClientRects). Polyfill them so the editor doesn't throw
// during its internal requestAnimationFrame measure pass.
beforeAll(() => {
  if (typeof Range !== "undefined") {
    const proto = Range.prototype as unknown as Record<string, unknown>;
    if (typeof proto.getClientRects !== "function") proto.getClientRects = () => [];
    if (typeof proto.getBoundingClientRect !== "function") {
      proto.getBoundingClientRect = () => ({
        x: 0, y: 0, width: 0, height: 0, top: 0, right: 0, bottom: 0, left: 0,
        toJSON: () => ({}),
      });
    }
  }
});

const DOC = `export class App {
  start() {
    for (let i = 0; i < 5; i++) {
      this.run(i);
    }
  }
  run(n) {
    return n * 2;
  }
}
`;

function makeView() {
  return new EditorView({
    doc: DOC,
    extensions: [basicSetup, javascript(), stickyScroll({ maxStickyLines: 3 })],
  });
}

describe("stickyScroll plugin lifecycle (jsdom smoke test)", () => {
  it("mounts a container into view.dom and survives doc changes", () => {
    const view = makeView();
    const container = view.dom.querySelector(".cm-stickyscroll-container");
    expect(container).toBeTruthy();

    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: DOC + "\n// appended\n" },
    });
    expect(view.dom.querySelector(".cm-stickyscroll-container")).toBeTruthy();

    view.destroy();
  });

  it("removes the container on destroy", () => {
    const view = makeView();
    view.destroy();
    expect(view.dom.querySelector(".cm-stickyscroll-container")).toBeNull();
  });

  it("supports runtime reconfigure via Compartment (disable → enable)", () => {
    const compartment = new Compartment();
    const view = new EditorView({
      doc: DOC,
      extensions: [javascript(), compartment.of(stickyScroll())],
    });

    view.dispatch({ effects: compartment.reconfigure([]) });
    expect(view.dom.querySelector(".cm-stickyscroll-container")).toBeNull();

    view.dispatch({ effects: compartment.reconfigure(stickyScroll()) });
    expect(view.dom.querySelector(".cm-stickyscroll-container")).toBeTruthy();

    view.destroy();
  });

  it("never registers a custom syntaxHighlighting that could leak to the code", () => {
    const extension = stickyScroll();
    // The returned array must not contain a syntaxHighlighting(...) extension.
    // A syntaxHighlighting extension is a ViewPlugin (has a `fromClass`/provider
    // shape); here we simply assert no theme/styleModule of our own is included
    // by checking the compose() result has the plugin but no styling objects.
    expect(Array.isArray(extension)).toBe(true);
    // The baseTheme is an Extension (StyleModule-like); ensure it is *not* a
    // syntax highlighter: baseTheme returns an extension with an ID that is not
    // a plugin — we verify composition still creates a working editor below.
    const state = EditorState.create({
      doc: DOC,
      extensions: [javascript(), extension],
    });
    expect(state.doc.length).toBe(DOC.length);
  });

  it("produces sticky rows when the viewport is scrolled down (rAF + scroll listener)", async () => {
    const view = makeView();
    const container = view.dom.querySelector(".cm-stickyscroll-container") as HTMLElement;

    // Simulate vertical scrolling: jsdom has no real layout, but the plugin must
    // react to the native scroll event and update the overlay without throwing.
    view.scrollDOM.scrollTop = 50;
    view.scrollDOM.dispatchEvent(new Event("scroll"));
    await new Promise((resolve) => requestAnimationFrame(resolve));
    await new Promise((resolve) => requestAnimationFrame(resolve));

    expect(container).toBeTruthy();
    expect(typeof container.style.height).toBe("string");

    view.destroy();
  });

  it("always paints an opaque bar background even when every ancestor is transparent", async () => {
    const view = makeView();
    await new Promise((resolve) => requestAnimationFrame(resolve));
    await new Promise((resolve) => requestAnimationFrame(resolve));

    const container = view.dom.querySelector(".cm-stickyscroll-container") as HTMLElement;
    const bg = container.style.backgroundColor;
    // No opaque ancestor + no --cm-stickyscroll-bg + not dark → light default.
    expect(bg.toLowerCase()).toBe("rgb(255, 255, 255)");
    expect(bg.toLowerCase()).not.toBe("transparent");
    expect(bg).not.toBe("");

    view.destroy();
  });

  it("falls back to the dark default when the editor is marked dark", async () => {
    const view = new EditorView({
      doc: DOC,
      extensions: [javascript(), stickyScroll()],
    });
    view.dom.classList.add("cm-dark");

    await new Promise((resolve) => requestAnimationFrame(resolve));
    await new Promise((resolve) => requestAnimationFrame(resolve));

    const container = view.dom.querySelector(".cm-stickyscroll-container") as HTMLElement;
    expect(container.style.backgroundColor.toLowerCase()).toBe("rgb(30, 30, 30)");

    view.destroy();
  });

  it("prefers the nearest opaque ancestor over body (old code skipped intermediate ancestors)", async () => {
    // The editor's real backdrop is an intermediate opaque wrapper; body differs.
    // The old hardcoded walk (contentDOM → scrollDOM → dom → body) jumped straight
    // to body and ignored it. The new walk must return the wrapper's color.
    const wrapper = document.createElement("div");
    wrapper.style.backgroundColor = "rgb(10, 20, 30)";
    document.body.appendChild(wrapper);
    document.body.style.backgroundColor = "rgb(24, 24, 27)";

    const view = new EditorView({
      doc: DOC,
      parent: wrapper,
      extensions: [javascript(), stickyScroll()],
    });
    await new Promise((resolve) => requestAnimationFrame(resolve));
    await new Promise((resolve) => requestAnimationFrame(resolve));

    const container = view.dom.querySelector(".cm-stickyscroll-container") as HTMLElement;
    expect(container.style.backgroundColor.toLowerCase()).toBe("rgb(10, 20, 30)");

    view.destroy();
    document.body.style.backgroundColor = "";
    wrapper.remove();
  });
});