import {publicConnection as sharedConnection} from './public-model.js?v=1';
// Automatic direct connection; no manual model setup.
export function bindModelDialog({onConnection}) {
  // Discard credentials from the former manual connection flow.
  try { sessionStorage.removeItem('zuowei-model-connection'); } catch {}
  const button = document.getElementById('settings-open');
  if (button) button.hidden = true;
  const notify = () => onConnection(sharedConnection);
  notify();
  return {open: notify, clear: notify};
}
