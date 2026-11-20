// When to open the "How to use" guide by itself.
// Only on a fresh install that came from IT policy ('admin') or a store ('normal').
// Unpacked copies ('development') are left alone so tests and testers get no extra tab.

export const GUIDE_PATH = 'src/help/help.html';

const GUIDED_INSTALL_TYPES = new Set(['admin', 'normal']);

export function shouldShowGuide(reason, installType) {
  return reason === 'install' && GUIDED_INSTALL_TYPES.has(installType);
}
