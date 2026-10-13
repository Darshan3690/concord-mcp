/**
 * Just enough TOML lexing to edit a config line by line without a parser:
 * which lines are inside a multi-line string, and which keys a line holds.
 */

type MultilineQuote = '"""' | "'''";

/** One line of TOML source; `inString` lines continue a multi-line string and hold no TOML. */
export interface TomlLine {
  readonly text: string;
  readonly inString: boolean;
}

/**
 * A TOML key path in one spelling: `mcp_servers . "concord"` → `mcp_servers.concord`. A part
 * that is not a bare key stays quoted, so `"concord.env"` remains one part, not two.
 */
export function tomlKeyPath(raw: string): string {
  const parts: string[] = [];
  let part = '';
  let index = 0;
  while (index < raw.length) {
    const char = raw[index];
    if (char === '"' || char === "'") {
      const end = singleLineStringEnd(raw, index);
      part += raw.slice(index + 1, end - 1);
      index = end;
      continue;
    }
    if (char === '.') {
      parts.push(part);
      part = '';
    } else if (char !== undefined && !/\s/u.test(char)) {
      part += char;
    }
    index += 1;
  }
  parts.push(part);
  return parts.map((key) => (/^[\w-]+$/u.test(key) ? key : JSON.stringify(key))).join('.');
}

function multilineQuoteAt(text: string, index: number): MultilineQuote | undefined {
  if (text.startsWith('"""', index)) return '"""';
  if (text.startsWith("'''", index)) return "'''";
  return undefined;
}

/** The index just past a single-line string opening at `start`, or the line's end if unclosed. */
function singleLineStringEnd(text: string, start: number): number {
  const quote = text[start];
  for (let index = start + 1; index < text.length; index += 1) {
    if (quote === '"' && text[index] === '\\') index += 1;
    else if (text[index] === quote) return index + 1;
  }
  return text.length;
}

/** The multi-line string still open after `text`, given the one open before it. */
function openStringAfter(
  text: string,
  open: MultilineQuote | undefined,
): MultilineQuote | undefined {
  let quote = open;
  let index = 0;
  while (index < text.length) {
    if (quote !== undefined) {
      if (quote === '"""' && text[index] === '\\') {
        index += 2;
      } else if (text.startsWith(quote, index)) {
        // Up to two more quotes may end the string's content.
        const mark = quote[0];
        index += 3;
        while (text[index] === mark) index += 1;
        quote = undefined;
      } else {
        index += 1;
      }
      continue;
    }
    const char = text[index];
    if (char === '#') break;
    const opening = multilineQuoteAt(text, index);
    if (opening !== undefined) {
      quote = opening;
      index += 3;
    } else if (char === '"' || char === "'") {
      index = singleLineStringEnd(text, index);
    } else {
      index += 1;
    }
  }
  return quote;
}

/** Each line of `source`, marked when it is the inside of a multi-line string. */
export function* tomlLines(source: string): Generator<TomlLine> {
  let open: MultilineQuote | undefined;
  for (const text of source.split(/\r?\n/u)) {
    yield { text, inString: open !== undefined };
    open = openStringAfter(text, open);
  }
}

/** The key paths an inline table value (`{ a = 1, b.c = { d = 2 } }`) sets at its top level. */
export function inlineTableKeys(value: string): string[] {
  const keys: string[] = [];
  if (!value.trimStart().startsWith('{')) return keys;
  let depth = 0;
  let keyStart: number | undefined;
  let index = 0;
  while (index < value.length) {
    const char = value[index];
    if (char === '"' || char === "'") {
      index = singleLineStringEnd(value, index);
      continue;
    }
    if (char === '#') break;
    if (char === '{' || char === '[') {
      depth += 1;
      if (depth === 1) keyStart = index + 1;
    } else if (char === '}' || char === ']') {
      depth -= 1;
      if (depth === 0) break;
    } else if (char === ',' && depth === 1) {
      keyStart = index + 1;
    } else if (char === '=' && depth === 1 && keyStart !== undefined) {
      keys.push(tomlKeyPath(value.slice(keyStart, index)));
      keyStart = undefined;
    }
    index += 1;
  }
  return keys;
}
