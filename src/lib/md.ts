/* Tiny, safe Markdown for AI copilot answers: bold, italic, code, lists, headings, tables, links. Everything is escaped first. */
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const inline = (s: string) => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/(^|[\s(])[*_]([^*_\n]+)[*_](?=[\s).,!?:;]|$)/g, '$1<i>$2</i>')
  .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
export function md(src: string) {
  const L = src.replace(/\r/g, '').split('\n'), out: string[] = []; let i = 0;
  while (i < L.length) {
    const l = L[i];
    if (/^```/.test(l)) { const b: string[] = []; i++; while (i < L.length && !/^```/.test(L[i])) b.push(L[i++]); i++; out.push(`<pre><code>${esc(b.join('\n'))}</code></pre>`); continue }
    if (/^\s*\|.*\|\s*$/.test(l) && i + 1 < L.length && /^\s*\|?\s*:?-{2,}/.test(L[i + 1])) {
      const row = (r: string) => r.trim().replace(/^\||\|$/g, '').split('|').map(c => inline(c.trim()));
      const head = row(l); i += 2; const rows: string[][] = []; while (i < L.length && /^\s*\|.*\|\s*$/.test(L[i])) rows.push(row(L[i++]));
      out.push(`<div class="mdtable"><table><thead><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`); continue }
    if (/^\s*[-*•]\s+/.test(l)) { const b: string[] = []; while (i < L.length && /^\s*[-*•]\s+/.test(L[i])) b.push(`<li>${inline(L[i++].replace(/^\s*[-*•]\s+/, ''))}</li>`); out.push(`<ul>${b.join('')}</ul>`); continue }
    if (/^\s*\d+[.)]\s+/.test(l)) { const b: string[] = []; while (i < L.length && /^\s*\d+[.)]\s+/.test(L[i])) b.push(`<li>${inline(L[i++].replace(/^\s*\d+[.)]\s+/, ''))}</li>`); out.push(`<ol>${b.join('')}</ol>`); continue }
    const h = /^(#{1,4})\s+(.*)$/.exec(l); if (h) { out.push(`<p class="mdh">${inline(h[2])}</p>`); i++; continue }
    if (!l.trim()) { i++; continue }
    const b: string[] = [inline(L[i++])]; while (i < L.length && L[i].trim() && !/^(```|\s*[-*•]\s|\s*\d+[.)]\s|#{1,4}\s|\s*\|)/.test(L[i])) b.push(inline(L[i++])); out.push(`<p>${b.join('<br>')}</p>`);
  }
  return out.join('');
}
