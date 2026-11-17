// Clean on send (classic content script, loaded before content.js and
// exposed as globalThis.__anonymizerSendGuard). Text typed by hand is
// checked when the user presses Enter or clicks Send: the send is held, the
// text box is anonymized, then the send is replayed, so the site's own
// handlers only ever read the anonymized text.
// A background check runs after each pause in typing. Text it found clean
// is let through as the real keystroke or click, so sites behave as usual.

(() => {
  if (globalThis.__anonymizerSendGuard) return;

  const CHECK_DELAY_MS = 500;
  const SEND_LABEL = /\b(send|submit)\b/i;
  const ENTER_CODE = 13;

  // Enter sends on most AI sites, Ctrl/Cmd+Enter on some. Shift+Enter is a
  // newline, and Enter during IME composition picks a candidate.
  const isSendKey = (e) => e.key === 'Enter' && !e.shiftKey && !e.altKey && !e.isComposing && e.keyCode !== 229;

  function keyEvent(type, init) {
    const event = new KeyboardEvent(type, init);
    // Older handlers read keyCode/which, which the constructor cannot set.
    Object.defineProperty(event, 'keyCode', { get: () => ENTER_CODE });
    Object.defineProperty(event, 'which', { get: () => ENTER_CODE });
    return event;
  }

  function hold(event) {
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  // `deps` are content.js helpers: send, ui, settings, editableRoot,
  // isTextControl, selectAll, selectedText, insertText, describeResult.
  function createSendGuard(deps) {
    const { send, ui, settings, editableRoot, isTextControl } = deps;
    const checked = new WeakMap(); // text box -> text known safe to send
    const timers = new WeakMap();
    let lastField = null;
    let busy = false;
    let replaying = false;
    let swallowKeyup = false;

    const on = () => settings().active && settings().checkTyping;
    const textOf = (field) => (isTextControl(field) ? field.value : field.innerText);
    const fieldOf = (event) => editableRoot(event.composedPath()[0] ?? event.target);
    const isSafe = (field) => {
      const text = textOf(field);
      return !text.trim() || checked.get(field) === text;
    };

    function replay(action) {
      replaying = true;
      try {
        action();
      } finally {
        replaying = false;
      }
    }

    // ---------- background check while typing ----------

    async function precheck(field) {
      const text = textOf(field);
      if (!text.trim() || checked.get(field) === text) return;
      try {
        const { found, warnings } = await send('scan', { text });
        if (!found && !warnings && textOf(field) === text) checked.set(field, text);
      } catch {
        // Left unchecked: the next send is held and checked in full.
      }
    }

    function onInput(event) {
      if (replaying || !on()) return;
      const field = fieldOf(event);
      if (!field) return;
      lastField = field;
      clearTimeout(timers.get(field));
      timers.set(field, setTimeout(() => precheck(field), CHECK_DELAY_MS));
    }

    // ---------- holding and replaying a send ----------

    // A rich editor is left with everything selected after the rewrite;
    // a replayed Enter must not type over it.
    function caretToEnd(field) {
      if (isTextControl(field)) return;
      const selection = window.getSelection();
      selection.selectAllChildren(field);
      selection.collapseToEnd();
    }

    async function cleanThen(field, resend) {
      if (busy) return;
      busy = true;
      const snapshot = deps.selectAll(field);
      const text = deps.selectedText(snapshot);
      const toast = ui.show({ status: 'busy', title: 'Checking your message before it is sent...' });
      try {
        const result = await send('anonymize', { text });
        if (result.text !== text) deps.insertText(snapshot, result.text);
        caretToEnd(field);
        checked.set(field, textOf(field));
        if (result.replacements.length || result.warnings.length) ui.update(toast, deps.describeResult(result));
        else toast.remove();
        resend();
      } catch (err) {
        caretToEnd(field);
        ui.update(toast, {
          status: 'error',
          title: 'Your message was not sent',
          body: err.message,
          actions: [{
            label: 'Send anyway',
            onClick: () => {
              checked.set(field, textOf(field));
              resend();
            },
          }],
        });
      } finally {
        busy = false;
      }
    }

    // What a real Enter would have done when the site does not handle it:
    // submit the form for a one-line field, else start a new line.
    function enterDefault(field) {
      field.focus();
      if (field instanceof HTMLInputElement) {
        field.form?.requestSubmit();
        return;
      }
      if (isTextControl(field)) {
        if (!document.execCommand('insertText', false, '\n')) field.setRangeText('\n', field.selectionStart, field.selectionEnd, 'end');
        return;
      }
      document.execCommand('insertParagraph');
    }

    function replayEnter(field, modifiers) {
      const init = { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true, composed: true, ...modifiers };
      replay(() => {
        const down = keyEvent('keydown', init);
        field.dispatchEvent(down);
        if (!down.defaultPrevented) {
          const press = keyEvent('keypress', init);
          field.dispatchEvent(press);
          if (!press.defaultPrevented) enterDefault(field);
        }
        field.dispatchEvent(keyEvent('keyup', init));
      });
    }

    function onKeydown(event) {
      if (replaying || !event.isTrusted || !on() || !isSendKey(event)) return;
      const field = fieldOf(event);
      if (!field || isSafe(field)) return;
      hold(event);
      swallowKeyup = true;
      const modifiers = { ctrlKey: event.ctrlKey, metaKey: event.metaKey };
      cleanThen(field, () => replayEnter(field, modifiers));
    }

    // Sites that send on keyup must not see the held key's release.
    function onKeyup(event) {
      if (!swallowKeyup || !event.isTrusted || event.key !== 'Enter') return;
      swallowKeyup = false;
      hold(event);
    }

    // A send button: submit buttons, or anything labelled Send/Submit
    // ("Send message", data-testid="send-button").
    function sendButtonOf(event) {
      const button = event.composedPath().find((n) => n instanceof Element && n.matches('button, [role="button"], input[type="submit"]'));
      if (!button) return null;
      const label = [button.getAttribute('aria-label'), button.getAttribute('title'), button.dataset.testid, button.textContent].join(' ');
      return button.type === 'submit' || SEND_LABEL.test(label) ? button : null;
    }

    // The text box the button sends: the one typed in last, else its form's.
    function composerFor(button) {
      if (lastField?.isConnected) return lastField;
      return [...(button.form?.elements ?? [])].find((el) => isTextControl(el)) ?? null;
    }

    function onClick(event) {
      if (replaying || !event.isTrusted || !on()) return;
      const button = sendButtonOf(event);
      const field = button && composerFor(button);
      if (!field || isSafe(field)) return;
      hold(event);
      cleanThen(field, () => replay(() => button.click()));
    }

    function onSubmit(event) {
      if (replaying || !on()) return;
      const form = event.target;
      const field = [...(form.elements ?? [])].find((el) => isTextControl(el) && !isSafe(el));
      if (!field) return;
      hold(event);
      cleanThen(field, () => replay(() => form.requestSubmit(event.submitter ?? undefined)));
    }

    function watch() {
      window.addEventListener('input', onInput, true);
      window.addEventListener('keydown', onKeydown, true);
      window.addEventListener('keyup', onKeyup, true);
      window.addEventListener('click', onClick, true);
      window.addEventListener('submit', onSubmit, true);
    }

    return { watch };
  }

  globalThis.__anonymizerSendGuard = { createSendGuard };
})();
