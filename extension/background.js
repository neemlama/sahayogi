// FormBuddy extension service worker. Two jobs:
//   1. Make the toolbar icon open the side panel (standard MV3 pattern).
//   2. Relay EXTRACT_PAGE / FILL_FIELDS requests from the side panel into
//      the active tab via chrome.scripting.executeScript.
//
// Deliberately does NOT declare a persistent content script -- these two
// functions are injected on demand, only when the side panel asks for
// them, keeping the extension's footprint on every page minimal.

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);
});

// --- Functions injected into the page. Everything inside must be
// self-contained (no closures over outer scope -- executeScript serializes
// the function body and runs it in the page's own JS context). ---

function extractPageForInspection() {
  const form = document.querySelector("form");
  const scope = form || document.body;
  return {
    html: scope.outerHTML,
    url: window.location.href,
    title: document.title,
  };
}

function fillFieldsInPage(fields) {
  // fields: [{selector, label, field_type, value}]. Never clicks submit.
  // Now fallback-tolerant for Google Forms (div[role=textbox], entry.xxx).
  function findEl(f) {
    let el = null;
    try { el = document.querySelector(f.selector); } catch {}
    // If selector hits a sentinel hidden input, prefer the visible widget in same listitem
    if (el && el.type === 'hidden' && el.name && el.name.includes('_sentinel')) {
      const li = el.closest('[role="listitem"]');
      if (li) {
        const cand = li.querySelector('input[type="text"], textarea, div[role="textbox"], [contenteditable="true"], [role="radio"], [role="listbox"]');
        if (cand) return cand;
      }
    }
    if (el && !el.closest('[role="listitem"]')?.querySelector('[role="radio"]') !== null) {
      // for radio fields the selector may point to hidden sentinel — handled below
    }
    if (el && el.getAttribute('role') !== 'radio' && el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA' && el.getAttribute('role') !== 'textbox') {
      // keep el if it's viable, otherwise try fallbacks
    }
    if (el) {
      // If it's a Google Forms radio container still, return it (select handling will find radio inside)
      if (el.closest('[role="listitem"]') && el.closest('[role="listitem"]').querySelector('[role="radio"]') && f.field_type === 'select') return el;
      // For text fields ensure we didn't land on wrong type
      if (f.field_type !== 'select' || el.tagName === 'SELECT' || el.getAttribute('role') === 'radio' || el.getAttribute('role') === 'textbox') return el;
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.getAttribute('contenteditable') === 'true') return el;
    }
    // Extract Google Forms entry id from any selector/label
    const m = (f.selector && f.selector.match(/entry\.\d+/)) || null;
    const entry = m ? m[0] : null;
    if (entry) {
      el = document.querySelector('[name="' + entry + '"]');
      if (el && el.type !== 'hidden') return el;
      el = document.querySelector('textarea[name="' + entry + '"], input[name="' + entry + '"]');
      if (el) return el;
      // Google Forms stores entry in data-params, actual widget is inside listitem
      const holder = document.querySelector('[data-params*="' + entry + '"]');
      if (holder) {
        const parent = holder.closest('[role="listitem"]') || holder.parentElement;
        if (parent) {
          if (f.field_type === 'select') return parent; // let select handler search radios inside
          const cand = parent.querySelector('input[type="text"], textarea, input[type="email"], div[role="textbox"], [contenteditable="true"], [role="radio"]');
          if (cand) return cand;
          return parent;
        }
      }
    }
    // Fallback by label text / aria-label (Google Forms shows label near listitem)
    const labelLower = (f.label || "").toLowerCase().trim();
    if (labelLower) {
      const short = labelLower.slice(0, 14);
      // try aria-label direct
      for (const c of document.querySelectorAll('input, textarea, div[role="textbox"], [contenteditable="true"]')) {
        const aria = (c.getAttribute('aria-label') || "").toLowerCase();
        if (aria && (aria.includes(labelLower) || labelLower.includes(aria.slice(0, 10)))) return c;
      }
      // try listitem containing label
      for (const item of document.querySelectorAll('[role="listitem"]')) {
        const txt = (item.innerText || "").toLowerCase();
        if (txt.includes(short)) {
          const cand = item.querySelector('input, textarea, div[role="textbox"], [contenteditable="true"]');
          if (cand) return cand;
        }
      }
    }
    return null;
  }

  function fillTextEl(el, value) {
    el.focus && el.focus();
    // Google Forms uses div[role=textbox] contenteditable
    if (el.getAttribute('role') === 'textbox' || el.getAttribute('contenteditable') === 'true') {
      el.textContent = value;
      el.dispatchEvent(new InputEvent('input', { bubbles: true, data: value }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.blur && el.blur();
      return;
    }
    // Standard input/textarea
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) setter.call(el, value); else el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true }));
    el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
    el.blur && el.blur();
  }

  const results = [];
  for (const f of fields) {
    if (f.value === null || f.value === undefined || f.value === "") {
      results.push({ label: f.label, ok: true, skipped: true });
      continue;
    }
    try {
      const el = findEl(f);
      if (!el) {
        results.push({ label: f.label, ok: false, error: "selector not found: " + f.selector + " (tried entry/aria fallbacks)" });
        continue;
      }
      if (f.field_type === "checkbox") {
        if (Boolean(f.value) !== el.checked) el.click();
      } else if (f.field_type === "select") {
        const targetVal = String(f.value).trim();
        // Native <select>
        const options = Array.from(el.options || []);
        if (options.length) {
          const match = options.find((o) => o.value === targetVal || o.text.trim() === targetVal);
          if (match) { el.value = match.value; el.dispatchEvent(new Event("change", { bubbles: true })); results.push({ label: f.label, ok: true }); continue; }
        }
        // Google Forms radio: div[role=radio][data-value] inside same listitem
        const scope = el.closest('[role="listitem"]') || el.closest('[data-params]')?.closest('[role="listitem"]') || document;
        // Try holder lookup for this entry
        let holder = null;
        if (f.selector && /entry\.\d+/.test(f.selector)) {
          const eid = f.selector.match(/entry\.\d+/)[0];
          holder = document.querySelector('[data-params*="' + eid + '"]');
        }
        const searchRoot = holder ? (holder.closest('[role="listitem"]') || holder) : scope;
        const norm = (s) => s.replace(/\s+/g,' ').trim().toLowerCase();
        const want = norm(targetVal);
        // radio
        let radio = [...searchRoot.querySelectorAll('[role="radio"][data-value]')].find(r => norm(r.getAttribute('data-value')||r.getAttribute('aria-label')||r.textContent) === want || norm(r.textContent).includes(want));
        if (radio) { radio.click(); results.push({ label: f.label, ok: true }); continue; }
        // listbox option
        let opt = [...searchRoot.querySelectorAll('[role="option"]')].find(o => norm(o.textContent) === want || norm(o.getAttribute('data-value')||'') === want);
        if (opt) { opt.click(); results.push({ label: f.label, ok: true }); continue; }
        // fallback: any span containing text
        let span = [...searchRoot.querySelectorAll('span')].find(s => norm(s.textContent) === want);
        if (span) { (span.closest('label')||span).click(); results.push({ label: f.label, ok: true }); continue; }
        results.push({ label: f.label, ok: false, error: "no matching option for " + f.value + " (searched radio/option in listitem)" });
        continue;
      } else {
        // For Google Forms radio mistakenly typed as text, try radio path first
        if (f.field_type === "text" || f.field_type === "textarea") {
          let holder = null;
          if (f.selector && /entry\.\d+/.test(f.selector)) {
            const eid = f.selector.match(/entry\.\d+/)[0];
            holder = document.querySelector('[data-params*="' + eid + '"]');
          }
          if (holder) {
            const li = holder.closest('[role="listitem"]');
            if (li && li.querySelector('[role="radio"]')) {
              // This is actually a radio field mis-typed — delegate to radio click
              const norm = (s) => s.replace(/\s+/g,' ').trim().toLowerCase();
              const want = norm(String(f.value));
              const radio = [...li.querySelectorAll('[role="radio"][data-value]')].find(r => norm(r.getAttribute('data-value')||'') === want || norm(r.textContent).includes(want));
              if (radio) { radio.click(); results.push({ label: f.label, ok: true }); continue; }
            }
          }
        }
        fillTextEl(el, String(f.value));
      }
      results.push({ label: f.label, ok: true });
    } catch (e) {
      results.push({ label: f.label, ok: false, error: String(e) });
    }
  }
  return results;
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) throw new Error("No active tab found");
  return tab;
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "EXTRACT_PAGE") {
    (async () => {
      try {
        const tab = await getActiveTab();
        const [{ result }] = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: extractPageForInspection,
        });
        sendResponse({ ok: true, ...result });
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
    })();
    return true; // keep sendResponse alive for the async work above
  }

  if (msg.type === "FILL_FIELDS") {
    (async () => {
      try {
        const tab = await getActiveTab();
        const [{ result }] = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: fillFieldsInPage,
          args: [msg.fields],
        });
        sendResponse({ ok: true, results: result });
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
    })();
    return true;
  }

  return false;
});
