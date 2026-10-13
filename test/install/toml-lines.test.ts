import { describe, expect, it } from 'vitest';

import { inlineTableKeys, tomlLines } from '../../src/install/toml-lines.js';

function insideStrings(source: string): string[] {
  return [...tomlLines(source)].filter((line) => line.inString).map((line) => line.text);
}

describe('tomlLines', () => {
  it('marks the inside of multi-line strings, and nothing else', () => {
    expect(insideStrings('a = """\n[x]\nb = 1\n"""\n[y]')).toEqual(['[x]', 'b = 1', '"""']);
    expect(insideStrings("a = '''one'''\nb = '''\n[x]\n'''")).toEqual(['[x]', "'''"]);
    expect(insideStrings('a = """ends with a quote""""\n[x]')).toEqual([]);
    expect(insideStrings('a = """\nescaped \\"""\n"""\n[x]')).toEqual(['escaped \\"""', '"""']);
  });

  it('reads triple quotes inside single-line strings and comments as text', () => {
    for (const line of [`a = '"""'`, `a = "'''"`, 'a = "\\"\\"\\""', '# """', "a = 1 # '''"]) {
      expect(insideStrings(`${line}\n[x]`)).toEqual([]);
    }
  });
});

describe('inlineTableKeys', () => {
  it('lists only the top-level keys of an inline table', () => {
    expect(inlineTableKeys(' { a = 1, "b" . c = { d = 2 }, e = [1, { f = 3 }] }')).toEqual([
      'a',
      'b.c',
      'e',
    ]);
    expect(inlineTableKeys(' { a = "x = 1, y = 2" }')).toEqual(['a']);
    expect(inlineTableKeys(' "{ a = 1 }"')).toEqual([]);
  });
});
