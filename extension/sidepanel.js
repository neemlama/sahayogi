// FormBuddy side panel. Talks to: (1) background.js via chrome.runtime
// messages for reading/filling the active tab, (2) the FormBuddy backend
// via fetch() for all agent reasoning (CORS-enabled for this, see
// api/main.py).

const BACKEND_URL = "http://localhost:8000";

const $ = (id) => document.getElementById(id);

// --- session id, persisted per-install via chrome.storage.local ---
async function getSessionId() {
  const { formbuddy_session_id } = await chrome.storage.local.get("formbuddy_session_id");
  if (formbuddy_session_id) return formbuddy_session_id;
  const id = "ext-" + Math.random().toString(36).slice(2, 10) + "-" + Date.now().toString(36);
  await chrome.storage.local.set({ formbuddy_session_id: id });
  return id;
}

async function resetSessionId() {
  const id = "ext-" + Math.random().toString(36).slice(2, 10) + "-" + Date.now().toString(36);
  await chrome.storage.local.set({ formbuddy_session_id: id });
  return id;
}

let sessionId = null;
let lastKnownFields = null; // the approved plan's fields, cached for the fill step

// --- profile vault (local + server cross-session memory) ---
async function loadProfile() {
  const { formbuddy_profile } = await chrome.storage.local.get("formbuddy_profile");
  $("profile-text").value = formbuddy_profile || "";
  // also pull server profile (saved via remember_user_details sequential Q&A) to keep in sync
  try {
    const r = await fetch(`${BACKEND_URL}/api/profile`);
    if (r.ok) {
      const data = await r.json();
      const prof = data.profile || {};
      if (Object.keys(prof).length && !formbuddy_profile?.trim()) {
        const text = Object.entries(prof).map(([k,v])=>`${k}: ${v}`).join("\n");
        $("profile-text").value = text;
        await chrome.storage.local.set({ formbuddy_profile: text });
      }
    }
  } catch {}
}

async function pushProfileToServer(text) {
  if (!text.trim()) return;
  const obj={};
  text.split("\n").forEach(l=>{ const i=l.indexOf(":"); if(i>-1) obj[l.slice(0,i).trim()]=l.slice(i+1).trim(); });
  try { await fetch(`${BACKEND_URL}/api/profile`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({profile:obj})}); } catch {}
}

$("profile-save").addEventListener("click", async () => {
  const text=$("profile-text").value;
  await chrome.storage.local.set({ formbuddy_profile: text });
  await pushProfileToServer(text);
  $("profile-saved-note").hidden = false;
  setTimeout(() => ($("profile-saved-note").hidden = true), 1500);
});

$("profile-toggle").addEventListener("click", () => {
  const body = $("profile-body");
  body.hidden = !body.hidden;
  $("profile-toggle-icon").textContent = body.hidden ? "▸" : "▾";
});

// --- messaging helpers ---
function addMessage(text, role) {
  const container = $("messages");
  container.hidden = false;
  const div = document.createElement("div");
  div.className = `msg ${role}`;
  div.textContent = text;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
  return div;
}

function extractPageFromTab() {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: "EXTRACT_PAGE" }, (resp) => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      if (!resp || !resp.ok) return reject(new Error((resp && resp.error) || "extraction failed"));
      resolve(resp);
    });
  });
}

function fillFieldsOnTab(fields) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: "FILL_FIELDS", fields }, (resp) => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      if (!resp || !resp.ok) return reject(new Error((resp && resp.error) || "fill failed"));
      resolve(resp.results);
    });
  });
}

async function sendChat(message, { pageHtml, pageUrl } = {}) {
  const body = { session_id: sessionId, message };
  if (pageHtml) {
    body.page_html = pageHtml;
    body.page_url = pageUrl;
  }
  const res = await fetch(`${BACKEND_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`chat failed: HTTP ${res.status}`);
  return (await res.json()).reply;
}

async function fetchSession() {
  const res = await fetch(`${BACKEND_URL}/api/session/${encodeURIComponent(sessionId)}`);
  return res.json();
}

// --- main flow ---
$("analyze-btn").addEventListener("click", async () => {
  $("analyze-btn").disabled = true;
  const thinking = addMessage("Reading the page...", "thinking");
  try {
    const page = await extractPageFromTab();
    thinking.textContent = "FormBuddy is analyzing the form...";

    const profile = (await chrome.storage.local.get("formbuddy_profile")).formbuddy_profile || "";
    const message = profile
      ? `Please analyze the form on this page for me. Here's what you know about me:\n${profile}`
      : "Please analyze the form on this page for me.";

    const reply = await sendChat(message, { pageHtml: page.html, pageUrl: page.url });
    thinking.remove();
    addMessage(reply, "agent");
    await refreshProposalCard();
  } catch (e) {
    thinking.remove();
    addMessage("⚠️ " + e.message, "agent");
  } finally {
    $("analyze-btn").disabled = false;
  }
});

$("reply-send").addEventListener("click", async () => {
  const text = $("reply-text").value.trim();
  if (!text) return;
  $("reply-text").value = "";
  addMessage(text, "user");
  const thinking = addMessage("Thinking...", "thinking");
  try {
    const reply = await sendChat(text);
    thinking.remove();
    addMessage(reply, "agent");
    await refreshProposalCard();
  } catch (e) {
    thinking.remove();
    addMessage("⚠️ " + e.message, "agent");
  }
});

function renderFieldTable(fields) {
  const table = $("proposal-fields");
  table.innerHTML = fields
    .map((f) => {
      const val = f.value === null || f.value === undefined || f.value === "" ? "(empty)" : String(f.value);
      const req = f.required ? " *" : "";
      return `<tr><td>${escapeHtml(f.label)}${req}</td><td>${escapeHtml(val)}</td></tr>`;
    })
    .join("");
}

function escapeHtml(s) {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

async function refreshProposalCard() {
  const session = await fetchSession();
  if (session.status !== "pending_approval") {
    $("proposal-section").hidden = true;
    return;
  }
  const p = session.proposal;
  lastKnownFields = p.fields;
  $("proposal-section").hidden = false;
  $("proposal-url").textContent = p.url;
  $("proposal-summary").textContent = p.summary_for_human;
  renderFieldTable(p.fields);
  $("reject-btn").disabled = false;
  $("authorize-btn").disabled = false;
}

$("reject-btn").addEventListener("click", async () => {
  $("reject-btn").disabled = true;
  $("authorize-btn").disabled = true;
  await fetch(`${BACKEND_URL}/api/session/${encodeURIComponent(sessionId)}/decide`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ decision: "rejected" }),
  });
  $("proposal-section").hidden = true;
  showResult(false, "Rejected. Nothing was filled.");
});

$("authorize-btn").addEventListener("click", async () => {
  $("reject-btn").disabled = true;
  $("authorize-btn").disabled = true;
  $("proposal-section").hidden = true;
  const thinking = addMessage("Filling the form in your tab...", "thinking");

  try {
    const decideRes = await fetch(`${BACKEND_URL}/api/session/${encodeURIComponent(sessionId)}/decide`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision: "approved" }),
    });
    const decideData = await decideRes.json();
    if (decideData.status !== "approved") {
      thinking.remove();
      showResult(false, decideData.message || "Unexpected status after approval.");
      return;
    }

    const results = await fillFieldsOnTab(lastKnownFields);
    thinking.remove();

    const filled = results.filter((r) => r.ok && !r.skipped).length;
    const skipped = results.filter((r) => r.skipped).length;
    const failed = results.filter((r) => !r.ok);
    const allOk = failed.length === 0;

    const notes = failed.length
      ? "Failed fields: " + failed.map((f) => `${f.label} (${f.error})`).join("; ")
      : `${filled} filled, ${skipped} left empty (no data)`;

    await fetch(`${BACKEND_URL}/api/session/${encodeURIComponent(sessionId)}/extension-result`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ok: allOk,
        confirmation_text: `${filled}/${lastKnownFields.length} fields filled`,
        notes,
      }),
    });

    if (allOk) {
      showResult(
        true,
        `✅ ${filled} field(s) filled in your tab. Nothing was submitted — please review the form and click Submit yourself when ready.`
      );
    } else {
      showResult(false, `⚠️ Some fields could not be filled: ${notes}`);
    }
  } catch (e) {
    thinking.remove();
    showResult(false, "⚠️ " + e.message);
  }
});

function showResult(success, text) {
  const section = $("result-section");
  const body = $("result-body");
  section.hidden = false;
  body.className = success ? "success" : "error";
  body.textContent = text;
}

$("new-session-btn").addEventListener("click", async () => {
  if (!confirm("Start a new session? This clears the current view (nothing is deleted server-side).")) return;
  sessionId = await resetSessionId();
  $("messages").innerHTML = "";
  $("messages").hidden = true;
  $("proposal-section").hidden = true;
  $("result-section").hidden = true;
});

// --- init ---
(async () => {
  sessionId = await getSessionId();
  await loadProfile();
})();
