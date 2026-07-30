/** Runnable self-check for the clipboard helper:  npm run check
 *  Node 22.6+ strips the types itself — no test framework, no build step.
 *
 *  What matters here is only the return value: every call site paints
 *  "Copied" from it, so a helper that reports success on a failed write is
 *  worse than no helper at all. The three paths are stubbed rather than
 *  driven through a real DOM.
 */

import { copyText } from "./clipboard.ts";

interface Stubs {
  writeText?: () => Promise<void>;
  execCommand?: () => boolean;
}

function install({ writeText, execCommand }: Stubs) {
  // Defined rather than assigned: Node ships a real `navigator` getter with no
  // setter, so a plain assignment throws before the first assertion runs.
  const define = (name: string, value: unknown) =>
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });

  define("navigator", writeText ? { clipboard: { writeText } } : {});
  define(
    "document",
    execCommand
      ? {
          execCommand,
          body: { appendChild() {}, removeChild() {} },
          createElement: () => ({ style: {}, setAttribute() {}, select() {}, value: "" }),
        }
      : undefined
  );
}

async function demo() {
  // 1. The ordinary path: the async API resolves, so it worked.
  install({ writeText: async () => {}, execCommand: () => false });
  console.assert((await copyText("x")) === true, "a resolved write should report success");

  // 2. Insecure origin — no navigator.clipboard at all. This is the case the
  //    old inline code threw on while the button still said "Copied".
  install({ execCommand: () => true });
  console.assert((await copyText("x")) === true, "the execCommand fallback should be used");

  // 3. Permission denied AND no fallback: the helper must admit it.
  install({
    writeText: async () => {
      throw new Error("denied");
    },
    execCommand: () => false,
  });
  console.assert((await copyText("x")) === false, "a failed copy must report failure");

  // 4. Nothing available at all — no throw escapes to the caller.
  install({});
  console.assert((await copyText("x")) === false, "a missing DOM must report failure");

  console.log("clipboard: async write, insecure-origin fallback, denial, and no-DOM all report honestly");
}

demo();
