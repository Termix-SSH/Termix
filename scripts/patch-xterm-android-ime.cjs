const fs = require("node:fs");
const path = require("node:path");

const xtermDir = path.join(
  __dirname,
  "..",
  "node_modules",
  "@xterm",
  "xterm",
  "lib",
);

// Backport the textarea-shrink fix from gmuxapp/xterm.js@6a011cf while
// xtermjs/xterm.js#3600 remains unresolved upstream. Android IMEs can restart
// composition on the previous word and replace it with a shorter value (for
// example, Vietnamese "Hoar" -> "Hỏa"). xterm 6.0 otherwise emits nothing.
const patches = [
  {
    file: "xterm.mjs",
    replacements: [
      [
        'this._compositionPosition={start:0,end:0},this._dataAlreadySent=""',
        'this._compositionPosition={start:0,end:0},this._preCompositionValue="",this._dataAlreadySent=""',
      ],
      [
        'this._compositionPosition.start=this._textarea.value.length,this._compositionView.textContent=""',
        'this._compositionPosition.start=this._textarea.value.length,this._preCompositionValue=this._textarea.value,this._compositionView.textContent=""',
      ],
      [
        "let e={start:this._compositionPosition.start,end:this._compositionPosition.end};this._isSendingComposition=!0",
        "let e={start:this._compositionPosition.start,end:this._compositionPosition.end};const s=this._preCompositionValue;this._isSendingComposition=!0",
      ],
      [
        "e.start+=this._dataAlreadySent.length,this._isComposing?i=this._textarea.value.substring(e.start,this._compositionPosition.start):i=this._textarea.value.substring(e.start),i.length>0&&",
        "e.start+=this._dataAlreadySent.length;if(this._isComposing)i=this._textarea.value.substring(e.start,this._compositionPosition.start);else{const t=this._textarea.value;if(t.length<s.length){let e=0;const r=Math.min(t.length,s.length);for(;e<r&&t.charCodeAt(e)===s.charCodeAt(e);)e++;i=b.DEL.repeat(s.length-e)+t.substring(e)}else i=t.substring(e.start)}i.length>0&&",
      ],
    ],
  },
  {
    file: "xterm.js",
    replacements: [
      [
        'this._compositionPosition={start:0,end:0},this._dataAlreadySent=""',
        'this._compositionPosition={start:0,end:0},this._preCompositionValue="",this._dataAlreadySent=""',
      ],
      [
        'this._compositionPosition.start=this._textarea.value.length,this._compositionView.textContent=""',
        'this._compositionPosition.start=this._textarea.value.length,this._preCompositionValue=this._textarea.value,this._compositionView.textContent=""',
      ],
      [
        "const e={start:this._compositionPosition.start,end:this._compositionPosition.end};this._isSendingComposition=!0",
        "const e={start:this._compositionPosition.start,end:this._compositionPosition.end},i=this._preCompositionValue;this._isSendingComposition=!0",
      ],
      [
        "e.start+=this._dataAlreadySent.length,t=this._isComposing?this._textarea.value.substring(e.start,this._compositionPosition.start):this._textarea.value.substring(e.start),t.length>0&&",
        "e.start+=this._dataAlreadySent.length;this._isComposing?t=this._textarea.value.substring(e.start,this._compositionPosition.start):(()=>{const s=this._textarea.value;if(s.length<i.length){let e=0;const r=Math.min(s.length,i.length);for(;e<r&&s.charCodeAt(e)===i.charCodeAt(e);)e++;t=a.C0.DEL.repeat(i.length-e)+s.substring(e)}else t=s.substring(e.start)})(),t.length>0&&",
      ],
    ],
  },
];

for (const { file, replacements } of patches) {
  const filePath = path.join(xtermDir, file);
  if (!fs.existsSync(filePath)) {
    throw new Error(`[patch-xterm-android-ime] Missing ${filePath}`);
  }

  let source = fs.readFileSync(filePath, "utf8");
  if (source.includes("_preCompositionValue")) {
    console.log(`[patch-xterm-android-ime] ${file} already patched`);
    continue;
  }

  for (const [original, patched] of replacements) {
    if (!source.includes(original)) {
      throw new Error(
        `[patch-xterm-android-ime] Expected source not found in ${file}`,
      );
    }
    source = source.replace(original, patched);
  }

  fs.writeFileSync(filePath, source);
  console.log(`[patch-xterm-android-ime] Patched ${file}`);
}
