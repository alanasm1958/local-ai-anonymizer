// Shared helper for extension pages to talk to the service worker.

export async function call(type, payload = {}) {
  const response = await chrome.runtime.sendMessage({ type, ...payload });
  if (!response?.ok) throw new Error(response?.error ?? 'No response from the extension');
  return response.data;
}

export const $ = (selector, root = document) => root.querySelector(selector);

export function h(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  Object.entries(attrs).forEach(([key, value]) => {
    if (key === 'class') node.className = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else if (value === true) node.setAttribute(key, '');
    else if (value !== false && value != null) node.setAttribute(key, value);
  });
  node.append(...children.flat().filter((c) => c != null));
  return node;
}

export async function copyText(button, text) {
  await navigator.clipboard.writeText(text);
  const original = button.textContent;
  button.textContent = 'Copied';
  setTimeout(() => { button.textContent = original; }, 1200);
}

export async function withBusy(button, task) {
  button.disabled = true;
  button.classList.add('busy');
  try {
    return await task();
  } finally {
    button.disabled = false;
    button.classList.remove('busy');
  }
}
