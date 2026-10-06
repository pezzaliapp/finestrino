// Lingua dell'app: italiano o inglese, scelta in base al telefono/browser.
// Ordine: ?lang=en|it nell'indirizzo, poi la scelta salvata, poi la lingua del dispositivo.
// Le chiavi sono le frasi italiane: se manca una traduzione, resta l'italiano.

const KEY = 'finestrino.lang.v1';

function detect() {
  const fromUrl = new URLSearchParams(location.search).get('lang');
  if (fromUrl === 'it' || fromUrl === 'en') {
    try { localStorage.setItem(KEY, fromUrl); } catch { /* */ }
    return fromUrl;
  }
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'it' || saved === 'en') return saved;
  } catch { /* */ }
  const langs = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || 'en'];
  return langs.some((l) => /^it\b/i.test(l)) ? 'it' : 'en';
}

export const LANG = detect();
export const LOCALE = LANG === 'en' ? 'en-GB' : 'it-IT';

export function setLang(lang) {
  try { localStorage.setItem(KEY, lang); } catch { /* */ }
  const url = new URL(location.href);
  url.searchParams.delete('lang');
  location.replace(url.toString());
}

let EN = {};
export function registerEnglish(dict) { EN = dict; }

/** Traduce una frase italiana; {nome} viene sostituito con vars.nome. */
export function t(it, vars) {
  let s = LANG === 'en' && EN[it] != null ? EN[it] : it;
  if (vars) s = s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] != null ? vars[k] : ''));
  return s;
}

/** Traduce l'HTML statico: data-i18n (testo), data-i18n-html (HTML), data-i18n-attr (attributi). */
export function translatePage() {
  document.documentElement.lang = LANG;
  if (LANG === 'it') return;
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(el.textContent.replace(/\s+/g, ' ').trim());
  });
  document.querySelectorAll('[data-i18n-html]').forEach((el) => {
    el.innerHTML = t(el.innerHTML.replace(/\s+/g, ' ').trim());
  });
  document.querySelectorAll('[data-i18n-attr]').forEach((el) => {
    for (const a of el.dataset.i18nAttr.split(',')) {
      if (el.hasAttribute(a)) el.setAttribute(a, t(el.getAttribute(a)));
    }
  });
}
