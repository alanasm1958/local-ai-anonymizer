// Shows real values in place of [PERSON_1]-style placeholders inside AI
// replies, for the user's eyes only. Loaded before content.js (same isolated
// world) and exposed as globalThis.__anonymizerReveal.
//
// Privacy: the page's own DOM keeps the placeholder text. Each placeholder is
// wrapped in a <span> whose visible text lives in a closed shadow root, which
// page scripts, analytics and session-replay tools cannot read.

(() => {
  if (globalThis.__anonymizerReveal) return;

  const PLACEHOLDER = /\[[A-Z][A-Z_]*?_\d+\]/g;
  const HAS_PLACEHOLDER = /\[[A-Z][A-Z_]*?_\d+\]/;
  const DEBOUNCE_MS = 120;
  const RETRY_MS = 1500;
  const MAX_LOOKUP = 500;
  const HOST_ATTR = 'data-anonymizer-reveal';
  const SKIP_SELECTOR = 'textarea, input, script, style, noscript, [contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"], local-anonymizer-ui';

  // The page can't read a closed shadow root, but it can measure the box it
  // renders. So the revealed text must not let page CSS pick its font: the
  // generic `monospace` keyword (unquoted) cannot be overridden by @font-face,
  // and every glyph is the same width, so only the character count shows.
  // `all: initial` stops the inner span inheriting anything the page set on
  // the host; only size (scales linearly) and color (no layout) inherit.
  const REVEAL_STYLE = `
    :host { display: inline; }
    span {
      all: initial;
      font-family: monospace;
      font-size: inherit;
      line-height: inherit;
      color: inherit;
      font-kerning: none;
      font-variant-ligatures: none;
      font-feature-settings: normal;
      letter-spacing: normal;
      word-spacing: normal;
      white-space: pre;
      border-bottom: 1px dotted currentColor;
      cursor: help;
    }
  `;

  function isEligible(node) {
    const parent = node.parentElement;
    if (!parent || parent.closest(`[${HOST_ATTR}]`)) return false;
    if (parent.isContentEditable || parent.closest(SKIP_SELECTOR)) return false;
    return HAS_PLACEHOLDER.test(node.data);
  }

  function makeHost(placeholder, original) {
    const host = document.createElement('span');
    host.setAttribute(HOST_ATTR, '');
    host.textContent = placeholder; // what the page sees
    const root = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = REVEAL_STYLE;
    const shown = document.createElement('span');
    shown.textContent = original; // what the user sees
    shown.title = `Shown locally by the anonymizer. The AI only saw ${placeholder}.`;
    root.append(style, shown);
    return host;
  }

  // Splits "Hi [PERSON_1]!" into nodes. The first piece stays in the original
  // text node so the framework that owns it keeps a valid reference.
  function buildPieces(text, map) {
    const pieces = [];
    let cursor = 0;
    for (const match of text.matchAll(PLACEHOLDER)) {
      const original = map[match[0]];
      if (original === undefined) continue;
      pieces.push(text.slice(cursor, match.index), makeHost(match[0], original));
      cursor = match.index + match[0].length;
    }
    if (pieces.length === 0) return null;
    pieces.push(text.slice(cursor));
    return pieces;
  }

  function createRevealer({ lookup }) {
    const groups = new Map(); // text node -> { source, inserted: Node[] }
    const pending = new Set();
    let observer = null;
    let timer = null;
    // Bumped on every start/stop, so a lookup that was in flight when the
    // vault was cleared can't paint the old values back.
    let generation = 0;

    function teardown(node, { restoreText }) {
      const group = groups.get(node);
      if (!group) return;
      group.inserted.forEach((n) => n.remove());
      if (restoreText && node.isConnected) node.data = group.source;
      groups.delete(node);
    }

    function queueTree(root) {
      if (root.nodeType === Node.TEXT_NODE) {
        pending.add(root);
        return;
      }
      if (root.nodeType !== Node.ELEMENT_NODE || root.closest?.(`[${HOST_ATTR}]`)) return;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) pending.add(n);
    }

    function handleRecords(records) {
      for (const record of records) {
        if (record.type === 'characterData') {
          // The page rewrote a node we had split: drop our pieces, re-apply.
          teardown(record.target, { restoreText: false });
          pending.add(record.target);
          continue;
        }
        record.removedNodes.forEach((n) => teardown(n, { restoreText: false }));
        record.addedNodes.forEach(queueTree);
      }
      schedule();
    }

    function schedule() {
      clearTimeout(timer);
      if (pending.size) timer = setTimeout(flush, DEBOUNCE_MS);
    }

    function apply(node, map) {
      if (!node.isConnected || groups.has(node) || !isEligible(node)) return;
      const pieces = buildPieces(node.data, map);
      if (!pieces) return;
      const [first, ...rest] = pieces;
      const inserted = rest.map((p) => (typeof p === 'string' ? document.createTextNode(p) : p)).filter((n) => n.nodeType !== Node.TEXT_NODE || n.data);
      const source = node.data;
      node.after(...inserted);
      node.data = first;
      groups.set(node, { source, inserted });
    }

    async function flush() {
      // Subtrees removed wholesale take our pieces with them; forget them.
      [...groups.keys()].filter((n) => !n.isConnected).forEach((n) => groups.delete(n));
      const nodes = [...pending].filter((n) => n.isConnected && !groups.has(n) && isEligible(n));
      pending.clear();
      if (!nodes.length || !observer) return;
      const wanted = [...new Set(nodes.flatMap((n) => n.data.match(PLACEHOLDER) ?? []))].slice(0, MAX_LOOKUP);
      const ticket = generation;
      let map;
      try {
        map = await lookup(wanted);
      } catch {
        // Worker restarting: try again shortly. Extension reloaded: give up.
        if (ticket !== generation || !chrome.runtime?.id) return;
        nodes.forEach((n) => pending.add(n));
        clearTimeout(timer);
        timer = setTimeout(flush, RETRY_MS);
        return;
      }
      if (!observer || ticket !== generation) return;
      handleRecords(observer.takeRecords()); // page changes that raced the lookup
      nodes.forEach((n) => apply(n, map));
      observer.takeRecords(); // our own edits: ignore
      schedule();
    }

    function start() {
      if (observer) return;
      generation += 1;
      observer = new MutationObserver(handleRecords);
      observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
      queueTree(document.body ?? document.documentElement);
      schedule();
    }

    function stop() {
      if (!observer) return;
      generation += 1;
      observer.disconnect();
      observer = null;
      clearTimeout(timer);
      pending.clear();
      [...groups.keys()].forEach((n) => teardown(n, { restoreText: true }));
    }

    // Used when the vault is cleared: placeholders go back on screen.
    function reset() {
      const running = Boolean(observer);
      stop();
      if (running) start();
    }

    return { start, stop, reset };
  }

  globalThis.__anonymizerReveal = Object.freeze({ createRevealer });
})();
