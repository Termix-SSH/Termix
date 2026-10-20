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

function checkUrls(css: string, errors: string[]): void {
  const urls = css.matchAll(/url\(\s*(['"]?)([^'")]*)\1\s*\)/gi);
  for (const match of urls) {
    const target = match[2].trim();
    if (target.startsWith("data:")) continue;
    if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("//")) {
      errors.push(`url(${target}) points outside the plugin`);
    }
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
