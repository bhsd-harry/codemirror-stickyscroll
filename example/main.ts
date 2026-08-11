import { EditorView, basicSetup } from "codemirror";
import { javascript } from "@codemirror/lang-javascript";
import { scrollStickyPlugin } from "../src/plugin";
import { stickyScrollFacet } from "../src/facet";

// Generate 1000 lines of code with nested blocks
let code = "function test() {\n";
for (let i = 0; i < 1000; i++) {
  if (i === 10) code += "  if (true) {\n";
  if (i === 500) code += "    while (true) {\n";
  code += `    console.log(${i});\n`;
  if (i === 900) code += "    }\n";
  if (i === 990) code += "  }\n";
}
code += "}\n";

const view = new EditorView({
  doc: code,
  extensions: [
    basicSetup,
    javascript(),
    scrollStickyPlugin,
    stickyScrollFacet.of({ maxStickyLines: 5 })
  ],
  parent: document.querySelector<HTMLDivElement>("#app")!
});

// Expose to window for debugging
(window as any).view = view;