// Temporary free access: credentials remain exclusively in the Worker.
// Personal-key UI can be restored from Git when this period ends.
const sharedConnection = Object.freeze({mode: 'shared', credential: '', model: '', searchKey: ''});
export function bindModelDialog({onConnection}) {
  // Discard credentials from the former manual connection flow.
  try { sessionStorage.removeItem('zuowei-model-connection'); } catch {}
  const button = document.getElementById('settings-open');
  if (button) button.hidden = true;
  const notify = () => onConnection(sharedConnection);
  notify();
  return {open: notify, clear: notify};
}
