import { PRODUCT_LABELS } from './products';

export interface TriageItem {
  id: string;
  topic: string;
  title: string;
  tag?: string;
  timestamp: string;
  commitUrl: string;
  gptSummary?: string;
  liveStatus?: 'pending' | 'live' | 'unknown';
  wentLiveAt?: string | null;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Minimal markdown -> HTML: handles bold, italic, inline code, links, bullet lists, line breaks.
// Not a full markdown parser — sufficient for gpt_summary_response payloads in this app.
function mdToHtml(md: string): string {
  if (!md) return '';
  const src = md.replace(/\\n/g, '\n').replace(/\\r/g, '').replace(/\\t/g, '    ');
  const lines = src.split(/\r?\n/);
  const out: string[] = [];
  let inList = false;

  const inline = (text: string) => {
    let s = escapeHtml(text);
    // links [text](url)
    s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, t, u) => `<a href="${u}">${t}</a>`);
    // bold **x**
    s = s.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
    // italic *x*
    s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<i>$2</i>');
    // inline code `x`
    s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
    return s;
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const bullet = line.match(/^\s*[-*+]\s+(.*)$/);
    if (bullet) {
      if (!inList) {
        out.push('<ul style="margin:4px 0 4px 20px">');
        inList = true;
      }
      out.push(`<li>${inline(bullet[1])}</li>`);
    } else if (line.trim() === '') {
      if (inList) {
        out.push('</ul>');
        inList = false;
      }
    } else {
      if (inList) {
        out.push('</ul>');
        inList = false;
      }
      out.push(`<div>${inline(line)}</div>`);
    }
  }
  if (inList) out.push('</ul>');
  return out.join('');
}

function badgeSpan(status?: string): string {
  if (status === 'live') {
    return '<span style="background:#22c55e;color:#fff;padding:2px 6px;border-radius:4px;font-size:11px;margin-right:6px">Live</span>';
  }
  if (status === 'pending') {
    return '<span style="background:#eab308;color:#000;padding:2px 6px;border-radius:4px;font-size:11px;margin-right:6px">Pending</span>';
  }
  return '';
}

function fmtDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toISOString().slice(0, 10);
  } catch {
    return iso;
  }
}

export function buildOneNoteHtml(items: TriageItem[], groupBy: 'product' | 'none' = 'product'): string {
  if (items.length === 0) {
    return '<div><i>(no items)</i></div>';
  }

  const groups = new Map<string, TriageItem[]>();
  if (groupBy === 'product') {
    for (const it of items) {
      const key = it.topic || 'Other';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(it);
    }
  } else {
    groups.set('All', items);
  }

  const chunks: string[] = [];
  chunks.push('<div style="font-family:Segoe UI, Arial, sans-serif;font-size:13px;color:#222">');
  for (const [topic, list] of groups) {
    const label = PRODUCT_LABELS[topic] ?? topic;
    chunks.push(`<h2 style="color:#333;border-bottom:1px solid #ccc;padding-bottom:4px">${escapeHtml(label)} (${list.length})</h2>`);
    chunks.push('<ul style="list-style:disc;margin:6px 0 12px 20px">');
    for (const it of list) {
      const tagPill = it.tag
        ? `<span style="background:#eef;color:#334;padding:2px 6px;border-radius:4px;font-size:11px;margin-right:6px">${escapeHtml(it.tag)}</span>`
        : '';
      chunks.push('<li style="margin-bottom:10px">');
      chunks.push(
        `<div>${badgeSpan(it.liveStatus)}${tagPill}<b><a href="${escapeHtml(it.commitUrl)}">${escapeHtml(it.title)}</a></b> ` +
          `<span style="color:#888">— ${fmtDate(it.timestamp)}</span></div>`
      );
      if (it.gptSummary) {
        chunks.push(`<div style="margin-left:0;margin-top:4px;color:#333">${mdToHtml(it.gptSummary)}</div>`);
      }
      chunks.push('</li>');
    }
    chunks.push('</ul>');
  }
  chunks.push('</div>');
  return chunks.join('');
}

export function buildMarkdown(items: TriageItem[], groupBy: 'product' | 'none' = 'product'): string {
  if (items.length === 0) return '(no items)';
  const groups = new Map<string, TriageItem[]>();
  if (groupBy === 'product') {
    for (const it of items) {
      const key = it.topic || 'Other';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(it);
    }
  } else {
    groups.set('All', items);
  }
  const out: string[] = [];
  for (const [topic, list] of groups) {
    const label = PRODUCT_LABELS[topic] ?? topic;
    out.push(`## ${label} (${list.length})`);
    out.push('');
    for (const it of list) {
      const badge = it.liveStatus === 'live' ? '[Live] ' : it.liveStatus === 'pending' ? '[Pending] ' : '';
      const tag = it.tag ? `[${it.tag}] ` : '';
      out.push(`- ${badge}${tag}**[${it.title}](${it.commitUrl})** — ${fmtDate(it.timestamp)}`);
      if (it.gptSummary) {
        const summaryLines = it.gptSummary
          .replace(/\\n/g, '\n')
          .split('\n')
          .filter(l => l.trim())
          .map(l => `  ${l}`);
        out.push(...summaryLines);
      }
    }
    out.push('');
  }
  return out.join('\n');
}

export async function copyToClipboard(html: string, plainMarkdown: string): Promise<void> {
  if (typeof window === 'undefined' || !navigator.clipboard) {
    throw new Error('Clipboard API not available');
  }
  if (typeof ClipboardItem !== 'undefined' && navigator.clipboard.write) {
    const htmlBlob = new Blob([html], { type: 'text/html' });
    const textBlob = new Blob([plainMarkdown], { type: 'text/plain' });
    await navigator.clipboard.write([
      new ClipboardItem({ 'text/html': htmlBlob, 'text/plain': textBlob }),
    ]);
    return;
  }
  await navigator.clipboard.writeText(plainMarkdown);
}
