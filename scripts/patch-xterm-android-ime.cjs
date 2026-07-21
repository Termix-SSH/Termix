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
//
// Also fixes _handleAnyTextareaChanges, which iOS Safari/WKWebView drives
// for ordinary typing (it reports keyCode 229 for all software-keyboard
// input, not just IME composition). That handler diffs the textarea value
// via `newValue.replace(oldValue, "")`, a literal substring removal. When
// keystrokes arrive faster than the function's setTimeout(0) callback runs,
// several overlapping callbacks each capture a stale oldValue, so the
// literal-substring search fails to match and the diff silently comes back
// empty - characters are dropped instead of sent. Swap in the same
// common-prefix diff used for composition-end above so a stale oldValue
// still yields the correct delta.
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
      [
        '_handleAnyTextareaChanges(){let t=this._textarea.value;setTimeout(()=>{if(!this._isComposing){let e=this._textarea.value,i=e.replace(t,"");this._dataAlreadySent=i,e.length>t.length?this._coreService.triggerDataEvent(i,!0):e.length<t.length?this._coreService.triggerDataEvent(`${b.DEL}`,!0):e.length===t.length&&e!==t&&this._coreService.triggerDataEvent(e,!0)}},0)}',
        "_handleAnyTextareaChanges(){let t=this._textarea.value;setTimeout(()=>{if(!this._isComposing){let e=this._textarea.value,r=0;const n=Math.min(e.length,t.length);for(;r<n&&e.charCodeAt(r)===t.charCodeAt(r);)r++;let i=e.length<t.length?b.DEL.repeat(t.length-r)+e.substring(r):e.substring(r);this._dataAlreadySent=i,i.length>0&&this._coreService.triggerDataEvent(i,!0)}},0)}",
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
      [
        '_handleAnyTextareaChanges(){const e=this._textarea.value;setTimeout((()=>{if(!this._isComposing){const t=this._textarea.value,i=t.replace(e,"");this._dataAlreadySent=i,t.length>e.length?this._coreService.triggerDataEvent(i,!0):t.length<e.length?this._coreService.triggerDataEvent(`${a.C0.DEL}`,!0):t.length===e.length&&t!==e&&this._coreService.triggerDataEvent(t,!0)}}),0)}',
        "_handleAnyTextareaChanges(){const e=this._textarea.value;setTimeout((()=>{if(!this._isComposing){const t=this._textarea.value;let r=0;const n=Math.min(t.length,e.length);for(;r<n&&t.charCodeAt(r)===e.charCodeAt(r);)r++;const i=t.length<e.length?a.C0.DEL.repeat(e.length-r)+t.substring(r):t.substring(r);this._dataAlreadySent=i,i.length>0&&this._coreService.triggerDataEvent(i,!0)}}),0)}",
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
  let changed = false;

  for (const [original, patched] of replacements) {
    if (source.includes(patched)) {
      continue;
    }
    if (!source.includes(original)) {
      throw new Error(
        `[patch-xterm-android-ime] Expected source not found in ${file}`,
      );
    }
    source = source.replace(original, patched);
    changed = true;
  }

  if (!changed) {
    console.log(`[patch-xterm-android-ime] ${file} already patched`);
    continue;
  }

  fs.writeFileSync(filePath, source);
  console.log(`[patch-xterm-android-ime] Patched ${file}`);
}
