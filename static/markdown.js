// A small Markdown renderer for journal entries.
// It builds DOM nodes with createElement and text, and never parses HTML, so nothing in an entry can
// inject markup or scripts. Links are only made for http(s) and mailto addresses.
// Supports **bold**, *italic* / _italic_, ~~strike~~, `code`, [text](url), # headings, - and 1. lists,
// > quotes and ``` code blocks.
const Markdown = (() => {
  const SAFE_URL = /^(https?:\/\/|mailto:)/i;
  const INLINE = /`([^`\n]+)`|\*\*(.+?)\*\*|__(.+?)__|~~(.+?)~~|\*(?![\s*])(.+?)\*|(?<!\w)_(?![\s_])(.+?)_(?!\w)|\[([^\]\n]+)\]\(([^)\s]+)\)/g;
  const BULLET = /^\s*[-*+]\s+(.*)/, NUMBERED = /^\s*(\d+)[.)]\s+(.*)/;
  const BLOCK_START = /^(```|#{1,3}\s|\s*[-*+]\s|\s*\d+[.)]\s|>)/;

  const el = (tag, ...kids) => { const e = document.createElement(tag); e.append(...kids); return e; }; // strings become text

  // links=false shows a link's text without the link (cards are buttons, which can't hold links).
  function inline(text, links = true) {
    const out = [];
    let last = 0;
    for (const m of text.matchAll(INLINE)) {
      const [whole, code, b1, b2, strike, i1, i2, label, href] = m;
      if (m.index > last) out.push(text.slice(last, m.index));
      last = m.index + whole.length;
      if (code !== undefined) out.push(el('code', code));
      else if ((b1 ?? b2) !== undefined) out.push(el('strong', ...inline(b1 ?? b2, links)));
      else if (strike !== undefined) out.push(el('s', ...inline(strike, links)));
      else if ((i1 ?? i2) !== undefined) out.push(el('em', ...inline(i1 ?? i2, links)));
      else if (!links) out.push(...inline(label, false));
      else if (SAFE_URL.test(href)) {
        const a = el('a', ...inline(label, false));
        a.href = href;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        out.push(a);
      } else out.push(whole); // e.g. a javascript: link: shown as typed, never made clickable
    }
    if (last < text.length) out.push(text.slice(last));
    return out;
  }

  const withBreaks = lines => lines.flatMap((line, k) => (k ? [document.createElement('br'), ...inline(line)] : inline(line)));

  // The full entry, for the expanded view.
  function renderMarkdown(text) {
    const frag = document.createDocumentFragment();
    const lines = text.split('\n');
    for (let i = 0; i < lines.length;) {
      const line = lines[i];
      let m;
      if (line.startsWith('```')) {
        const code = [];
        for (i++; i < lines.length && !lines[i].startsWith('```'); i++) code.push(lines[i]);
        i++; // the closing fence; an unclosed block just runs to the end
        frag.append(el('pre', el('code', code.join('\n'))));
      } else if ((m = /^(#{1,3})\s+(.*)/.exec(line))) {
        frag.append(el(`h${m[1].length + 3}`, ...inline(m[2]))); // h4-h6, below the page's own headings
        i++;
      } else if (BULLET.test(line) || NUMBERED.test(line)) {
        const re = BULLET.test(line) ? BULLET : NUMBERED;
        const list = el(re === BULLET ? 'ul' : 'ol');
        if (re === NUMBERED) list.start = Number(NUMBERED.exec(line)[1]);
        for (; i < lines.length && (m = re.exec(lines[i])); i++) list.append(el('li', ...inline(m[m.length - 1])));
        frag.append(list);
      } else if (line.startsWith('>')) {
        const quote = [];
        for (; i < lines.length && lines[i].startsWith('>'); i++) quote.push(lines[i].replace(/^>\s?/, ''));
        frag.append(el('blockquote', ...withBreaks(quote)));
      } else if (!line.trim()) {
        i++;
      } else {
        const para = []; // consecutive lines stay one paragraph, with their line breaks kept
        do para.push(lines[i++]); while (i < lines.length && lines[i].trim() && !BLOCK_START.test(lines[i]));
        frag.append(el('p', ...withBreaks(para)));
      }
    }
    return frag;
  }

  // A card's short preview: inline formatting only, with markers like # and - tidied into plain text.
  function renderPreview(text) {
    return text.split('\n').filter(line => !line.startsWith('```')).flatMap((line, k) => {
      const heading = /^#{1,3}\s+(.*)/.exec(line);
      const nodes = heading
        ? [el('strong', ...inline(heading[1], false))]
        : inline(line.replace(/^(\s*)[-*+]\s+/, '$1• ').replace(/^>\s?/, ''), false);
      return k ? ['\n', ...nodes] : nodes;
    });
  }

  return { renderMarkdown, renderPreview };
})();

if (typeof module === 'object') module.exports = Markdown; // for test_markdown.cjs under Node
