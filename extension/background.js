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
    if (el) return el;
    // Extract Google Forms entry id from any selector/label
    const m = (f.selector && f.selector.match(/entry\.\d+/)) || null;
    const entry = m ? m[0] : null;
    if (entry) {
      el = document.querySelector('[name="' + entry + '"]');
      if (el) return el;
      el = document.querySelector('textarea[name="' + entry + '"], input[name="' + entry + '"]');
      if (el) return el;
      // Google Forms often stores entry in data-params, actual input is inside listitem
      const holder = document.querySelector('[data-params*="' + entry + '"]');
      if (holder) {
        const parent = holder.closest('[role="listitem"]') || holder.parentElement;
        if (parent) {
          const cand = parent.querySelector('input[type="text"], textarea, input[type="email"], div[role="textbox"], [contenteditable="true"]');
          if (cand) return cand;
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
        const options = Array.from(el.options || []);
        const match = options.find((o) => o.value === f.value || o.text.trim() === String(f.value).trim());
        if (!match) {
          // For Google Forms select is a div[role=listbox] — try clicking option text
          const listbox = el.closest('[role="listitem"]') || document;
          const opt = [...listbox.querySelectorAll('[role="option"]')].find(o => o.textContent.trim() === String(f.value).trim());
          if (opt) { opt.click(); results.push({ label: f.label, ok: true }); continue; }
          results.push({ label: f.label, ok: false, error: "no matching option for " + f.value });
          continue;
        }
        el.value = match.value;
        el.dispatchEvent(new Event("change", { bubbles: true }));
      } else {
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
