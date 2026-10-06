// Aggiornamento automatico all'ultima versione.
// 1) Il service worker (sw.js) chiede sempre i file nuovi alla rete, e usa la copia salvata solo offline.
// 2) Ogni pochi minuti l'app legge version.json: se è cambiato, si ricarica da sola
//    (aspettando che tu scenda dall'aereo, per non interrompere un volo).

import { t } from './i18n.js';

const CHECK_EVERY = 5 * 60 * 1000;
let current = null;

async function readVersion() {
  try {
    const res = await fetch(`version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return null;
    return (await res.json()).version || null;
  } catch {
    return null;
  }
}

/**
 * @param {() => boolean} canReload  restituisce true quando ricaricare non disturba
 * @param {(msg: string) => void} notify  mostra un avviso
 */
export async function startAutoUpdate(canReload, notify) {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  current = await readVersion();
  let pending = false;

  const check = async () => {
    if (pending) return tryReload();
    const latest = await readVersion();
    if (latest && current && latest !== current) {
      pending = true;
      tryReload();
    }
  };

  const tryReload = () => {
    if (!canReload()) return; // riprova al prossimo controllo
    notify(t('È uscita una nuova versione di Finestrino. Aggiorno…'));
    setTimeout(() => location.reload(), 1500);
  };

  setInterval(check, CHECK_EVERY);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
  window.addEventListener('focus', check);

  return current;
}
