/**
 * Checks a theme's CSS before core serves it.
 *
 * A theme is colors and styles only, so its file may hold nothing but rules
 * whose every selector starts with the theme's own class (`.nord`,
 * `:root.nord`, `html.nord ...`), optionally inside @media or @supports.
 * Anything that could load from elsewhere or run code is refused: @import,
 * url() to another host, other at-rules, expression() and javascript:.
 */

const ALLOWED_BLOCK_AT_RULES = new Set(["media", "supports"]);

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, " ");
}

/** Splits on commas that are not inside parentheses or brackets. */
function splitSelectors(prelude: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of prelude) {
    if (ch === "(" || ch === "[") depth += 1;
    if (ch === ")" || ch === "]") depth -= 1;
    if (ch === "," && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  parts.push(current);
  return parts.map((part) => part.trim());
}

function withoutStrings(css: string): string {
  return css.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, '""');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Index of the brace closing the one at `open`, skipping strings. */
function matchingBrace(css: string, open: number): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = open; i < css.length; i += 1) {
    const ch = css[i];
    if (quote) {
      if (ch === "\\") i += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

// Where a theme file is served, to resolve its relative urls the way the
// browser does. Only paths under the plugin's own assets are allowed.
const THEME_BASE = "https://theme.invalid/plugin-assets/p/_themes/t.css";
const PLUGIN_ROOT = "/plugin-assets/p/";
const LOADING_FUNCTIONS = new Set(["image-set", "-webkit-image-set", "src"]);
const DATA_TYPES = /^data:(image\/|font\/|application\/(x-)?font-)/i;

function checkTarget(raw: string, errors: string[]): void {
  const target = raw.trim();
  if (/^data:/i.test(target)) {
    if (!DATA_TYPES.test(target)) {
      errors.push(`url(${target}) is not an image or font`);
    }
    return;
  }
  let url: URL;
  try {
    url = new URL(target, THEME_BASE);
  } catch {
    errors.push(`url(${target}) is not a valid address`);
    return;
  }
  if (
    url.origin !== new URL(THEME_BASE).origin ||
    !url.pathname.startsWith(PLUGIN_ROOT)
  ) {
    errors.push(`url(${target}) points outside the plugin`);
  }
}

function isHex(ch: string | undefined): boolean {
  return !!ch && /[0-9a-f]/i.test(ch);
}

/** Reads one escape after a backslash at `i`; returns the char and next index. */
function readEscape(css: string, i: number): [string, number] {
  let j = i + 1;
  if (isHex(css[j])) {
    let hex = "";
    while (hex.length < 6 && isHex(css[j])) hex += css[j++];
    if (/[ \t\n\r\f]/.test(css[j] ?? "")) j += 1;
    const code = parseInt(hex, 16);
    const valid =
      code > 0 && code <= 0x10ffff && (code < 0xd800 || code > 0xdfff);
    return [valid ? String.fromCodePoint(code) : "�", j];
  }
  return [css[j] ?? "", j + 1];
}

function isNameChar(ch: string): boolean {
  return /[\w-]/.test(ch) || ch.charCodeAt(0) > 0x7f;
}

/**
 * Finds every address the CSS can load, with escapes decoded the way the
 * browser decodes them: url() tokens, url("...") and strings inside
 * image-set() or src(). Also catches escaped names like expr\65ssion.
 */
function checkUrls(css: string, errors: string[]): void {
  const stack: string[] = [];
  let i = 0;
  while (i < css.length) {
    const ch = css[i];
    if (ch === '"' || ch === "'") {
      let value = "";
      let j = i + 1;
      while (j < css.length && css[j] !== ch) {
        if (css[j] === "\\") {
          const [decoded, next] = readEscape(css, j);
          value += decoded;
          j = next;
        } else value += css[j++];
      }
      const inside = stack[stack.length - 1];
      if (inside === "url" || (inside && LOADING_FUNCTIONS.has(inside))) {
        checkTarget(value, errors);
      }
      i = j + 1;
      continue;
    }
    if (isNameChar(ch) || ch === "\\") {
      let name = "";
      let j = i;
      while (j < css.length && (isNameChar(css[j]) || css[j] === "\\")) {
        if (css[j] === "\\") {
          const [decoded, next] = readEscape(css, j);
          name += decoded;
          j = next;
        } else name += css[j++];
      }
      const lower = name.toLowerCase();
      if (
        lower === "expression" ||
        lower === "-moz-binding" ||
        lower === "behavior"
      ) {
        errors.push(
          lower === "expression"
            ? "expression() is not allowed in a theme"
            : "Script bindings are not allowed in a theme",
        );
      }
      if (lower.includes("javascript")) {
        errors.push("javascript: is not allowed in a theme");
      }
      if (css[j] === "(") {
        if (lower === "url") {
          let k = j + 1;
          while (/\s/.test(css[k] ?? "")) k += 1;
          if (css[k] !== '"' && css[k] !== "'") {
            let value = "";
            while (k < css.length && css[k] !== ")") {
              if (css[k] === "\\") {
                const [decoded, next] = readEscape(css, k);
                value += decoded;
                k = next;
              } else value += css[k++];
            }
            checkTarget(value, errors);
            i = k + 1;
            continue;
          }
        }
        stack.push(lower);
        i = j + 1;
        continue;
      }
      i = j;
      continue;
    }
    if (ch === "(") stack.push("");
    else if (ch === ")") stack.pop();
    i += 1;
  }
}

function checkRules(
  css: string,
  scope: RegExp,
  themeId: string,
  errors: string[],
): void {
  let index = 0;
  while (index < css.length) {
    const rest = css.slice(index);
    if (rest.trim() === "") return;
    const open = css.indexOf("{", index);
    const semicolon = css.indexOf(";", index);
    if (semicolon !== -1 && (open === -1 || semicolon < open)) {
      const statement = css.slice(index, semicolon).trim();
      errors.push(
        statement.startsWith("@")
          ? `${statement.split(/\s/)[0]} is not allowed in a theme`
          : `Unexpected "${statement}" outside a rule`,
      );
      index = semicolon + 1;
      continue;
    }
    if (open === -1) {
      errors.push(`Unexpected "${rest.trim()}" at the end`);
      return;
    }
    const close = matchingBrace(css, open);
    if (close === -1) {
      errors.push("A rule is missing its closing brace");
      return;
    }
    const prelude = css.slice(index, open).trim();
    const body = css.slice(open + 1, close);

    if (prelude.startsWith("@")) {
      const name = prelude.slice(1).split(/[\s(]/)[0].toLowerCase();
      if (ALLOWED_BLOCK_AT_RULES.has(name)) {
        checkRules(body, scope, themeId, errors);
      } else {
        errors.push(`@${name} is not allowed in a theme`);
      }
    } else {
      for (const selector of splitSelectors(prelude)) {
        if (!scope.test(selector)) {
          errors.push(
            `Selector "${selector}" must start with .${themeId}, :root.${themeId} or html.${themeId}`,
          );
        }
      }
      if (withoutStrings(body).includes("{")) {
        errors.push(`Nested rules are not allowed in "${prelude}"`);
      }
    }
    index = close + 1;
  }
}

/** Every problem with a theme's CSS, empty when it is safe to serve. */
export function validateThemeCss(css: string, themeId: string): string[] {
  const errors: string[] = [];
  const clean = stripComments(css);
  if (/@import\b/i.test(clean))
    errors.push("@import is not allowed in a theme");
  if (/expression\s*\(/i.test(clean))
    errors.push("expression() is not allowed in a theme");
  if (/javascript:/i.test(clean))
    errors.push("javascript: is not allowed in a theme");
  if (/-moz-binding|behavior\s*:/i.test(clean))
    errors.push("Script bindings are not allowed in a theme");
  checkUrls(clean, errors);
  const id = escapeRegExp(themeId);
  const scope = new RegExp(`^(?::root|html)?\\.${id}(?![\\w-])`);
  checkRules(clean, scope, themeId, errors);
  return [...new Set(errors)];
}
