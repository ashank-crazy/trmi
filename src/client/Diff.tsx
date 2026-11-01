import type { ReactNode } from 'react';
import type { DiffLine } from '../shared/types';

type Lang = 'ts' | 'py';

export function langOf(file: string): Lang {
  return file.endsWith('.py') ? 'py' : 'ts';
}

/** How a line is referred to in comments: its new line number, or its old one if it was removed. */
export function lineLabel(lines: DiffLine[], index: number): string {
  const line = lines[index];
  return `L${line?.newNo ?? line?.oldNo ?? index + 1}`;
}

// comment | string | number | word
const TS_TOKENS = /(\/\/.*)|('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`)|(\b\d[\d_.]*\b)|([A-Za-z_$][\w$]*)/g;
const PY_TOKENS = /(#.*)|('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")|(\b\d[\d_.]*\b)|([A-Za-z_]\w*)/g;

const KEYWORDS: Record<Lang, Set<string>> = {
  ts: new Set(
    'const let var function return if else for while await async import from export new try catch throw interface type typeof of in null undefined true false this'.split(
      ' ',
    ),
  ),
  py: new Set('def return if else elif for in not and or is None True False import from raise with as class lambda'.split(' ')),
};

/** A small line-by-line highlighter: enough to make diffs readable, not a parser. */
export function highlight(text: string, lang: Lang): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(lang === 'py' ? PY_TOKENS : TS_TOKENS)) {
    const [token, comment, str, num, word] = m;
    const at = m.index;
    if (at > last) out.push(text.slice(last, at));
    let kind: string | null = null;
    if (comment) kind = 'comment';
    else if (str) kind = 'string';
    else if (num) kind = 'number';
    else if (word && KEYWORDS[lang].has(word)) kind = 'keyword';
    else if (word && text[at + token.length] === '(') kind = 'fn';
    else if (word && /^[A-Z][a-z]/.test(word)) kind = 'type';
    out.push(
      kind ? (
        <span key={at} className={`tok-${kind}`}>
          {token}
        </span>
      ) : (
        token
      ),
    );
    last = at + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const SIGN = { add: '+', del: '-', ctx: ' ' } as const;

export function DiffView({
  file,
  lines,
  bugLine = null,
  counts,
  selected = null,
  onSelect,
}: {
  file: string;
  lines: DiffLine[];
  /** a line to flag as the bug */
  bugLine?: number | null;
  /** comments per line */
  counts?: Map<number, number>;
  selected?: number | null;
  onSelect?: (index: number) => void;
}): React.JSX.Element {
  const lang = langOf(file);
  return (
    <div className="diff">
      <div className="diff-file">{file}</div>
      <div className="diff-body">
        {lines.map((line, i) => {
          const classes = ['diff-row', line.kind];
          if (onSelect) classes.push('clickable');
          if (i === selected) classes.push('selected');
          if (i === bugLine) classes.push('bug');
          const count = counts?.get(i) ?? 0;
          return (
            <div key={i} className={classes.join(' ')} onClick={onSelect && (() => onSelect(i))}>
              <span className="diff-no old">{line.oldNo ?? ''}</span>
              {onSelect ? (
                <button type="button" className="diff-no" aria-label={`Comment on ${lineLabel(lines, i)}`}>
                  {line.newNo ?? ''}
                </button>
              ) : (
                <span className="diff-no">{line.newNo ?? ''}</span>
              )}
              <span className="diff-sign">{SIGN[line.kind]}</span>
              <code className="diff-code">{highlight(line.text, lang)}</code>
              {i === bugLine && <span className="diff-flag bug-flag">bug</span>}
              {count > 0 && (
                <span className="diff-flag" title={`${count} comment${count === 1 ? '' : 's'}`}>
                  {count}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
