// Tests for static/markdown.js. Run with `node --test test_markdown.cjs` (pytest also runs it).
const test = require('node:test');
const assert = require('node:assert');

// Just enough of a DOM for markdown.js, serialised back to HTML so expectations read naturally.
// Text is escaped on output, so a "<b>" in the result means markup was really created.
class El {
  constructor(tag) { this.tag = tag; this.kids = []; }
  append(...kids) { this.kids.push(...kids.map(k => (typeof k === 'string' ? new Txt(k) : k))); }
  get html() {
    const attrs = ['href', 'target', 'rel', 'start'].filter(a => this[a] !== undefined).map(a => ` ${a}="${this[a]}"`).join('');
    const inner = this.kids.map(k => k.html).join('');
    return this.tag ? `<${this.tag}${attrs}>${inner}</${this.tag}>` : inner;
  }
}
class Txt {
  constructor(text) { this.text = text; }
  get html() { return this.text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
}
global.document = { createElement: tag => new El(tag), createDocumentFragment: () => new El(null) };

const { renderMarkdown, renderPreview } = require('./static/markdown.js');
const md = text => renderMarkdown(text).html;
const preview = text => { const f = new El(null); f.append(...renderPreview(text)); return f.html; };

test('inline formatting', () => {
  assert.equal(md('**bold**, *it*, _it_, ~~no~~ and `x*y*`'),
    '<p><strong>bold</strong>, <em>it</em>, <em>it</em>, <s>no</s> and <code>x*y*</code></p>');
  assert.equal(md('**bold with *italic* inside**'), '<p><strong>bold with <em>italic</em> inside</strong></p>');
  assert.equal(md('my_var_name and 2 * 3 * 4'), '<p>my_var_name and 2 * 3 * 4</p>'); // not mistaken for italics
});

test('paragraphs keep their line breaks', () => {
  assert.equal(md('a\nb\n\n\nc'), '<p>a<br></br>b</p><p>c</p>');
});

test('headings, lists, quotes and code blocks', () => {
  assert.equal(md('# Title\n#hashtag'), '<h4>Title</h4><p>#hashtag</p>');
  assert.equal(md('- one\n- **two**\ntext'), '<ul><li>one</li><li><strong>two</strong></li></ul><p>text</p>');
  assert.equal(md('3. c\n4) d'), '<ol start="3"><li>c</li><li>d</li></ol>');
  assert.equal(md('> hi\n> there'), '<blockquote>hi<br></br>there</blockquote>');
  assert.equal(md('```\n**raw** <b>\n```\nafter'), '<pre><code>**raw** &lt;b&gt;</code></pre><p>after</p>');
  assert.equal(md('```\nnever closed'), '<pre><code>never closed</code></pre>');
});

test('HTML in an entry stays text', () => {
  assert.equal(md('<img src=x onerror=alert(1)> **<script>**'),
    '<p>&lt;img src=x onerror=alert(1)&gt; <strong>&lt;script&gt;</strong></p>');
});

test('only safe links become links', () => {
  assert.equal(md('[site](https://example.com)'),
    '<p><a href="https://example.com" target="_blank" rel="noopener noreferrer">site</a></p>');
  assert.equal(md('[x](javascript:alert(1))'), '<p>[x](javascript:alert(1))</p>');
  assert.equal(md('[x](data:text/html,hi)'), '<p>[x](data:text/html,hi)</p>');
});

test('card preview: inline formatting, no links or blocks', () => {
  assert.equal(preview('# Title\n- item [a](https://x.y) **b**\n> quoted\n```\ncode'),
    '<strong>Title</strong>\n• item a <strong>b</strong>\nquoted\ncode');
});
