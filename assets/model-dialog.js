const sessionKey = 'zuowei-model-connection';
const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel(sessionKey) : null;

function restore() {
  try {
    const value = JSON.parse(sessionStorage.getItem(sessionKey));
    if (['shared', 'personal'].includes(value?.mode) && typeof value.credential === 'string' &&
        value.credential && typeof value.model === 'string') return value;
  } catch {}
  return null;
}

let current = restore();
const listeners = new Set();
const sender = crypto.randomUUID();

function store(value) {
  current = value;
  try {
    if (value) sessionStorage.setItem(sessionKey, JSON.stringify(value));
    else sessionStorage.removeItem(sessionKey);
  } catch {}
  for (const listener of listeners) listener(current);
}

function publish(value) {
  store(value);
  channel?.postMessage({sender, kind: 'update', value});
}

channel?.addEventListener('message', ({data}) => {
  if (data?.kind === 'update' || (data?.kind === 'reply' && data.to === sender && !current)) store(data.value);
  if (data?.kind === 'hello' && current) channel.postMessage({kind: 'reply', to: data.sender, value: current});
});
channel?.postMessage({kind: 'hello', sender});
window.addEventListener('pageshow', event => {
  if (event.persisted) {
    store(restore());
    channel?.postMessage({kind: 'hello', sender});
  }
});

export function bindModelDialog({authenticate, onConnection, onLogin}) {
  const $ = id => document.getElementById(id);
  const dialog = $('settings');
  const status = $('login-status');
  const modes = [...dialog.querySelectorAll('[name="connection-mode"]')];
  const submit = $('connect-submit');
  const disconnect = $('disconnect');
  const clearInputs = () => {
    for (const id of ['access-password', 'api-key', 'search-key']) $(id).value = '';
  };
  const mode = () => modes.find(input => input.checked).value;
  function updateMode() {
    const shared = mode() === 'shared';
    $('shared-fields').classList.toggle('hidden', !shared);
    $('personal-fields').classList.toggle('hidden', shared);
    $('access-password').disabled = !shared;
    $('access-password').required = shared;
    for (const id of ['api-key', 'model']) {
      $(id).disabled = shared;
      $(id).required = !shared;
    }
    status.textContent = '';
  }
  let login;
  function open() {
    clearInputs();
    for (const input of modes) input.checked = input.value === (current?.mode || 'shared');
    $('model').value = current?.model || 'deepseek-flash';
    updateMode();
    if (current) status.textContent = current.mode === 'shared' ? '已连接最尾厝密钥。' : '已配置自己的 API 密钥。';
    dialog.showModal();
  }
  const notify = value => {
    $('connection-dot').classList.toggle('connected', Boolean(value));
    onConnection(value);
  };
  listeners.add(notify);
  notify(current);
  $('settings-open').addEventListener('click', open);
  $('settings-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => { login?.abort(); clearInputs(); });
  for (const input of modes) input.addEventListener('change', updateMode);
  disconnect.addEventListener('click', () => {
    login?.abort();
    publish(null);
    clearInputs();
    status.textContent = '已清除两个问答页的连接。';
  });
  $('settings-form').addEventListener('submit', async event => {
    event.preventDefault();
    if (login) return;
    const selected = mode();
    const candidate = {
      mode: selected, credential: selected === 'shared' ? $('access-password').value : $('api-key').value.trim(),
      model: $('model').value.trim(), searchKey: $('search-key').value.trim(),
    };
    if (!candidate.credential || (selected === 'personal' && !candidate.model)) return;
    login = new AbortController();
    const timer = setTimeout(() => login.abort(), 20000);
    submit.disabled = true;
    for (const input of modes) input.disabled = true;
    status.textContent = selected === 'shared' ? '正在验证最尾厝密钥…' : '正在验证 API 密钥…';
    try {
      await authenticate(candidate, login.signal);
      login.signal.throwIfAborted();
      publish(candidate);
      dialog.close();
      onLogin?.();
    } catch (error) {
      if (dialog.open) status.textContent = login.signal.aborted ? '连接超时或已取消，请重试。' :
        error instanceof TypeError ? '无法连接问答服务，请检查网络。' : error.message;
    } finally {
      clearTimeout(timer);
      login = null;
      submit.disabled = false;
      for (const input of modes) input.disabled = false;
    }
  });
  return {open, clear: () => publish(null)};
}
