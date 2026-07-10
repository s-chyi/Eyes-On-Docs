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

// Minimal markdown -> HTML.
function mdToHtml(md: string): string {
  if (!md) return '';
  const src = md.replace(/\\n/g, '\n').replace(/\\r/g, '').replace(/\\t/g, '    ');
  const lines = src.split(/\r?\n/);
  const out: string[] = [];
  let inList = false;

  const inline = (text: string) => {
    let s = escapeHtml(text);
    s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, t, u) => `<a href="${u}" style="color:#2563eb;text-decoration:none">${t}</a>`);
    s = s.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
    s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<i>$2</i>');
    s = s.replace(/`([^`]+)`/g, '<code style="background:#f1f5f9;padding:1px 5px;border-radius:3px;font-family:Consolas,monospace;font-size:12px;color:#334155">$1</code>');
    return s;
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const bullet = line.match(/^\s*[-*+]\s+(.*)$/);
    if (bullet) {
      if (!inList) {
        out.push('<ul style="margin:6px 0 6px 22px;padding:0;color:#334155">');
        inList = true;
      }
      out.push(`<li style="margin-bottom:3px">${inline(bullet[1])}</li>`);
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
      out.push(`<div style="margin:4px 0;color:#334155">${inline(line)}</div>`);
    }
  }
  if (inList) out.push('</ul>');
  return out.join('');
}

function badgePill(status?: string): string {
  if (status === 'live') {
    return '<span style="display:inline-block;background:#dcfce7;color:#166534;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;margin-right:6px;vertical-align:middle">● Live</span>';
  }
  if (status === 'pending') {
    return '<span style="display:inline-block;background:#fef3c7;color:#854d0e;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;margin-right:6px;vertical-align:middle">○ Pending</span>';
  }
  return '';
}

function fmtDate(iso: string): string {
  try {
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  } catch {
    return iso;
  }
}

// Product-color palette: cycle through a few soft accents so groups are visually distinguishable.
const GROUP_ACCENTS = [
  { bar: '#3b82f6', bg: '#eff6ff', text: '#1e3a8a' }, // blue
  { bar: '#10b981', bg: '#ecfdf5', text: '#064e3b' }, // emerald
  { bar: '#8b5cf6', bg: '#f5f3ff', text: '#4c1d95' }, // violet
  { bar: '#f59e0b', bg: '#fffbeb', text: '#78350f' }, // amber
  { bar: '#ec4899', bg: '#fdf2f8', text: '#831843' }, // pink
  { bar: '#06b6d4', bg: '#ecfeff', text: '#164e63' }, // cyan
  { bar: '#f97316', bg: '#fff7ed', text: '#7c2d12' }, // orange
];

export function buildOneNoteHtml(items: TriageItem[], groupBy: 'product' | 'none' = 'product'): string {
  if (items.length === 0) return '<div><i>(no items)</i></div>';

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

  const dateStr = fmtDate(new Date().toISOString());
  const chunks: string[] = [];
  chunks.push('<div style="font-family:\'Segoe UI\',Arial,sans-serif;font-size:14px;color:#1e293b;line-height:1.55">');

  // Title bar
  chunks.push(
    `<div style="border-left:4px solid #0ea5e9;padding:6px 0 6px 12px;margin-bottom:14px">` +
    `<div style="font-size:18px;font-weight:700;color:#0f172a">Doc Triage — ${escapeHtml(dateStr)}</div>` +
    `<div style="font-size:12px;color:#64748b;margin-top:2px">共 ${items.length} 則更新，跨 ${groups.size} 個產品</div>` +
    `</div>`
  );

  let idx = 0;
  for (const [topic, list] of groups) {
    const label = PRODUCT_LABELS[topic] ?? topic;
    const c = GROUP_ACCENTS[idx % GROUP_ACCENTS.length];
    idx++;

    chunks.push(
      `<div style="background:${c.bg};border-left:4px solid ${c.bar};padding:8px 12px;margin:16px 0 10px;border-radius:0 4px 4px 0">` +
      `<span style="color:${c.text};font-weight:700;font-size:15px">${escapeHtml(label)}</span>` +
      `<span style="color:${c.text};opacity:0.7;font-size:12px;margin-left:8px">${list.length} 則</span>` +
      `</div>`
    );

    for (const it of list) {
      const tagPill = it.tag
        ? `<span style="display:inline-block;background:#e2e8f0;color:#475569;padding:2px 8px;border-radius:10px;font-size:11px;margin-right:6px;vertical-align:middle">${escapeHtml(it.tag)}</span>`
        : '';
      chunks.push(
        `<div style="border:1px solid #e2e8f0;border-radius:6px;padding:10px 12px;margin-bottom:8px;background:#ffffff">`
      );
      chunks.push(
        `<div style="margin-bottom:6px">${badgePill(it.liveStatus)}${tagPill}` +
        `<a href="${escapeHtml(it.commitUrl)}" style="color:#0f172a;font-weight:600;font-size:14px;text-decoration:none">${escapeHtml(it.title)}</a>` +
        `<span style="color:#94a3b8;font-size:11px;margin-left:8px">${fmtDate(it.timestamp)}</span>` +
        `</div>`
      );
      if (it.gptSummary) {
        chunks.push(`<div style="font-size:13px">${mdToHtml(it.gptSummary)}</div>`);
      }
      chunks.push('</div>');
    }
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
  out.push(`# Doc Triage — ${fmtDate(new Date().toISOString())}`);
  out.push('');
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
  // Wrap HTML in a minimal doc + charset meta — helps OneNote/Word not strip styles.
  const wrappedHtml = `<!doctype html><html><head><meta charset="utf-8"></head><body>${html}</body></html>`;
  if (typeof ClipboardItem !== 'undefined' && navigator.clipboard.write) {
    const htmlBlob = new Blob([wrappedHtml], { type: 'text/html' });
    const textBlob = new Blob([plainMarkdown], { type: 'text/plain' });
    await navigator.clipboard.write([
      new ClipboardItem({ 'text/html': htmlBlob, 'text/plain': textBlob }),
    ]);
    return;
  }
  await navigator.clipboard.writeText(plainMarkdown);
}
