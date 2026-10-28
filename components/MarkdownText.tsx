'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * Markdown 渲染器（assistant 消息专用）
 *
 * 两个关键点：
 * 1. fence-aware 预处理：模型输出的换行常是单个 `\n`，CommonMark 需要空行才分段。
 *    但绝不能在代码块/行内 code 内部插空行（会破坏内容）——
 *    所以先按 ``` 围栏切段，只对段外内容做 `\n`→`\n\n`，行内 code 段（反引号对）同样跳过。
 * 2. 引用角标：模型输出 `[1]`、`[2]` 这类「裸角标」不是合法链接语法，
 *    预处理转成 `[1](#cite-1)`，再由 components.a 拦截 #cite-* 交给 onCite 点击溯源。
 *    已是链接的 `[文本](url)` 不受影响（负向前瞻 `(?!\()`）。
 */

/** GFM 表格行（以 | 开头）：行间必须保持单换行，插空行会打断表格解析 */
function isTableRow(line: string): boolean {
  const t = line.trim();
  return t.startsWith('|') && t.includes('|', 1);
}

/**
 * 段外文本：裸角标 [1] → [1](#cite-1)；单换行 → 空行分段。
 * 例外：相邻两行都是表格行时保持单换行（否则 remark-gfm 无法拼出 <table>，
 * 表格会退化成一段段 `| 指标 | …` 原文）。
 */
function transformProse(text: string): string {
  const cited = text.replace(/\[([1-9]\d?)\](?!\()/g, '[$1](#cite-$1)');
  const lines = cited.split('\n');
  let out = '';
  for (let i = 0; i < lines.length; i += 1) {
    if (i > 0) {
      const prev = lines[i - 1];
      const keepSingle = isTableRow(prev) && isTableRow(lines[i]);
      out += keepSingle ? '\n' : '\n\n';
    }
    out += lines[i];
  }
  return out;
}

/**
 * fence-aware 预处理：
 * - ``` 围栏段（含语言标记的整段代码块）：原样保留
 * - 行内 code 反引号段：原样保留
 * - 其余文本段：transformProse
 */
export function preprocessMarkdown(raw: string): string {
  // 先按 ``` 围栏切分（fence 之间为奇数段 code，偶数段 prose）
  const fenceParts = raw.split(/(```[\s\S]*?(?:```|$))/);
  return fenceParts
    .map((part, i) => {
      if (i % 2 === 1) return part; // 代码块原样
      // prose 段内再按行内 code 反引号切分
      const inlineParts = part.split(/(`[^`\n]+`)/);
      return inlineParts.map((seg, j) => (j % 2 === 1 ? seg : transformProse(seg))).join('');
    })
    .join('');
}

interface MarkdownTextProps {
  text: string;
  /** 点击 [n] 角标时回调（n 为角标序号，1-based） */
  onCite?: (n: number) => void;
  /** 附加类名（用于气泡底色适配，如 user 侧白字） */
  className?: string;
}

/** 非链接元素的通用类名 */
const BLOCK_CLS = 'text-sm leading-relaxed text-slate-800';

export function MarkdownText({ text, onCite, className }: MarkdownTextProps) {
  return (
    <div className={`md-body text-sm ${className ?? ''}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p className={`${BLOCK_CLS} my-1.5 first:mt-0 last:mb-0`}>{children}</p>,
          a: ({ href, children }) => {
            // 引用角标 [1](#cite-1) → 可点 <sup><button>
            const citeMatch = href ? /^#cite-([1-9]\d?)$/.exec(href) : null;
            if (citeMatch) {
              const n = Number(citeMatch[1]);
              return (
                <sup>
                  <button
                    type="button"
                    onClick={() => onCite?.(n)}
                    className="mx-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-brand-100 px-1 align-super text-xs font-semibold text-brand-700 transition hover:bg-brand-600 hover:text-white"
                    title={`查看来源 [${n}]`}
                  >
                    {n}
                  </button>
                </sup>
              );
            }
            return (
              <a
                href={href}
                target="_blank"
                rel="noreferrer"
                className="text-brand-600 underline underline-offset-2 hover:text-brand-800"
              >
                {children}
              </a>
            );
          },
          ul: ({ children }) => <ul className={`${BLOCK_CLS} my-1.5 list-disc space-y-1 pl-5`}>{children}</ul>,
          ol: ({ children }) => <ol className={`${BLOCK_CLS} my-1.5 list-decimal space-y-1 pl-5`}>{children}</ol>,
          li: ({ children }) => <li className="marker:text-brand-400">{children}</li>,
          h1: ({ children }) => <h3 className={`${BLOCK_CLS} mt-3 mb-1 font-bold first:mt-0`}>{children}</h3>,
          h2: ({ children }) => <h3 className={`${BLOCK_CLS} mt-3 mb-1 font-bold first:mt-0`}>{children}</h3>,
          h3: ({ children }) => <h4 className={`${BLOCK_CLS} mt-2 mb-1 font-semibold first:mt-0`}>{children}</h4>,
          strong: ({ children }) => <strong className="font-semibold text-slate-900">{children}</strong>,
          em: ({ children }) => <em className="italic">{children}</em>,
          hr: () => <hr className="my-3 border-slate-200" />,
          blockquote: ({ children }) => (
            <blockquote className={`${BLOCK_CLS} my-2 border-l-2 border-brand-300 pl-3 text-slate-600`}>
              {children}
            </blockquote>
          ),
          code: ({ className: cls, children }) => {
            // 代码块内的 code（有 fence className）走 pre 分支；此处只处理行内
            if (cls) return <code className={cls}>{children}</code>;
            return (
              <code className="rounded bg-slate-100 px-1.5 py-0.5 text-[13px] text-rose-600">
                {children}
              </code>
            );
          },
          pre: ({ children }) => (
            <pre className="my-2 overflow-x-auto rounded-lg bg-slate-900 p-3 text-[13px] leading-relaxed text-slate-100">
              {children}
            </pre>
          ),
          table: ({ children }) => (
            <div className="my-2 overflow-x-auto">
              <table className="w-full border-collapse text-[13px]">{children}</table>
            </div>
          ),
          thead: ({ children }) => <thead className="bg-slate-100">{children}</thead>,
          th: ({ children }) => (
            <th className="border border-slate-200 px-2 py-1.5 text-left font-semibold text-slate-700">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border border-slate-200 px-2 py-1.5 text-slate-700">{children}</td>
          ),
          input: (props) => (
            // GFM 任务列表复选框（只读展示）
            <input type="checkbox" disabled {...props} className="mr-1 accent-brand-600" />
          ),
        }}
      >
        {preprocessMarkdown(text)}
      </ReactMarkdown>
    </div>
  );
}
