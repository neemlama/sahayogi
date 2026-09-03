// FormBuddy frontend — talks only to the same-origin FastAPI backend
// (api/main.py). No framework, no build step: deliberately simple.

const SESSION_KEY = "formbuddy_session_id";

function getSessionId() {
  let id = localStorage.getItem(SESSION_KEY);
  if (!id) {
    id = "web-" + Math.random().toString(36).slice(2, 10) + "-" + Date.now().toString(36);
    localStorage.setItem(SESSION_KEY, id);
  }
  return id;
}

const sessionId = getSessionId();

const PROFILE_KEY = "formbuddy_profile";
function getProfile() { return localStorage.getItem(PROFILE_KEY) || ""; }
function setProfile(v) { localStorage.setItem(PROFILE_KEY, v); }

async function syncProfileFromServer() {
  try {
    const r = await fetch("/api/profile");
    if (!r.ok) return;
    const data = await r.json();
    const prof = data.profile || {};
    if (!Object.keys(prof).length) return;
    const text = Object.entries(prof).map(([k,v])=>`${k}: ${v}`).join("\n");
    if (!getProfile().trim()) { // only auto-fill vault if empty, don't overwrite user's vault
      profileText.value = text;
      setProfile(text);
    }
  } catch {}
}
async function pushProfileToServer() {
  const raw = getProfile();
  if (!raw.trim()) return;
  const obj = {};
  raw.split("\n").forEach(line=>{
    const idx=line.indexOf(":");
    if(idx>-1) obj[line.slice(0,idx).trim()] = line.slice(idx+1).trim();
  });
  try { await fetch("/api/profile",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({profile:obj})}); } catch {}
}

// profile vault UI
const profileText = document.getElementById("profile-text");
const profileBody = document.getElementById("profile-body");
const profileToggle = document.getElementById("profile-toggle");
const profileToggleIcon = document.getElementById("profile-toggle-icon");
const profileSaveBtn = document.getElementById("profile-save");
const profileClearBtn = document.getElementById("profile-clear");
const profileSavedNote = document.getElementById("profile-saved-note");
if (profileText) profileText.value = getProfile();
if (profileToggle) profileToggle.addEventListener("click", () => {
  profileBody.hidden = !profileBody.hidden;
  profileToggleIcon.textContent = profileBody.hidden ? "▸" : "▾";
});
if (profileSaveBtn) profileSaveBtn.addEventListener("click", async () => {
  setProfile(profileText.value);
  await pushProfileToServer();
  profileSavedNote.hidden = false;
  setTimeout(() => profileSavedNote.hidden = true, 1500);
});
if (profileClearBtn) profileClearBtn.addEventListener("click", async () => {
  profileText.value = ""; setProfile("");
  try { await fetch("/api/profile",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({profile:{}})}); } catch {}
});

const messagesEl = document.getElementById("messages");
const formEl = document.getElementById("chat-form");
const inputEl = document.getElementById("chat-input");
const proposalCard = document.getElementById("proposal-card");
const proposalBody = document.getElementById("proposal-body");
const proposalActions = document.getElementById("proposal-actions");
const decisionResult = document.getElementById("decision-result");
const decisionNote = document.getElementById("decision-note");
const approveBtn = document.getElementById("approve-btn");
const rejectBtn = document.getElementById("reject-btn");
const activityLog = document.getElementById("activity-log");

function addMessage(text, role) {
  const div = document.createElement("div");
  div.className = `msg ${role}`;
  div.textContent = text;
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return div;
}

async function sendChat(message) {
  // if user just hit send with empty input but has a saved profile, use it
  const profile = getProfile();
  let fullMessage = message;
  if (profile && !message.toLowerCase().includes("my name is") && !message.toLowerCase().includes("email")) {
    // only auto-append if message looks like just a URL or short ask
    if (message.trim().split(/\s+/).length <= 8 || /https?:\/\//.test(message)) {
      fullMessage = message + (message.trim() ? "\n\n" : "") + "Here's what you know about me:\n" + profile;
    }
  }
  addMessage(message || "(using saved profile)", "user");
  inputEl.value = "";
  formEl.querySelector("button").disabled = true;
  const thinking = addMessage("FormBuddy is thinking...", "thinking");

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: sessionId, message: fullMessage }),
    });
    const data = await res.json();
    thinking.remove();
    const replyDiv = addMessage(data.reply, "agent");
    // If backend says session already decided, surface a clear hint to use New Conversation
    if (/already resolved|already decided|create a new session|new session_id/i.test(data.reply)) {
      const hint = document.createElement("div");
      hint.className = "msg agent";
      hint.style.background = "#fffbeb";
      hint.style.border = "1px solid #fcd34d";
      hint.style.fontSize = "13px";
      hint.textContent = "Tip: Click 🔄 New Conversation (top-right) to start a fresh session — the old one is closed and cannot be reused (see agent/tools/proposal.py:74). Your vault profile is kept.";
      messagesEl.appendChild(hint);
    }
    // If reply asks for missing required fields, highlight them in the input placeholder
    const missingMatch = data.reply.match(/required fields[^\n:]*:\s*\[([^\]]+)\]/i) || data.reply.match(/missing[^:]*:\s*([^\n]+)/i);
    if (missingMatch) {
      inputEl.placeholder = "Missing: " + missingMatch[1].slice(0, 80) + " — type them and press Send";
      inputEl.focus();
    }
  } catch (err) {
    thinking.remove();
    addMessage("Something went wrong reaching FormBuddy: " + err, "agent");
  } finally {
    formEl.querySelector("button").disabled = false;
    refreshSession();
    refreshActivity();
    syncProfileFromServer(); // pull cross-session memory saved via remember_user_details
  }
}

formEl.addEventListener("submit", (e) => {
  e.preventDefault();
  const message = inputEl.value.trim();
  if (message) sendChat(message);
});

function fieldRow(label, value) {
  return `<div><strong>${label}:</strong> ${value}</div>`;
}

function renderProposalBody(proposal) {
  const fieldRows = (proposal.fields || [])
    .map((f) => {
      const empty = f.value === null || f.value === undefined || f.value === "";
      const value = empty ? "<em>(empty)</em>" : escapeHtml(String(f.value));
      const reqTag = f.required ? ' <span style="color:#b45309;">*</span>' : "";
      const rowStyle = empty && f.required ? ' style="background:#fffbeb;" title="Required — ask, don\'t invent"' : "";
      return `<tr${rowStyle}><td>${escapeHtml(f.label)}${reqTag}</td><td>${value}</td></tr>`;
    })
    .join("");

  return (
    fieldRow("URL", `<a href="${escapeHtml(proposal.url)}" target="_blank" rel="noopener">${escapeHtml(proposal.url)}</a>`) +
    `<div style="margin-top:10px;">${escapeHtml(proposal.summary_for_human)}</div>` +
    (fieldRows ? `<table class="review-table" style="margin-top:10px;">${fieldRows}</table>` : "")
  );
}

async function refreshSession() {
  const res = await fetch(`/api/session/${encodeURIComponent(sessionId)}`);
  const session = await res.json();

  if (session.status === "pending_approval") {
    const p = session.proposal;
    proposalCard.hidden = false;
    proposalActions.hidden = false;
    decisionResult.hidden = true;
    approveBtn.disabled = false;
    rejectBtn.disabled = false;
    proposalBody.innerHTML = renderProposalBody(p);
  } else if (["submitted", "rejected", "submission_failed"].includes(session.status)) {
    proposalCard.hidden = false;
    proposalActions.hidden = true; // decision is final -- no point showing a disabled note+buttons
    proposalBody.innerHTML = session.proposal ? renderProposalBody(session.proposal) : "—";
    decisionResult.hidden = false;
    if (session.status === "submitted") {
      decisionResult.className = "decision-result success";
      decisionResult.textContent = "✅ Submitted. This session is closed.";
    } else if (session.status === "rejected") {
      decisionResult.className = "decision-result pending";
      decisionResult.textContent = "❌ Rejected. No submission was made.";
    } else {
      decisionResult.className = "decision-result error";
      decisionResult.textContent = "⚠️ Submission failed. See agent activity for details.";
    }
  } else {
    proposalCard.hidden = true;
  }
}

function escapeHtml(s) {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

async function decide(decision) {
  approveBtn.disabled = true;
  rejectBtn.disabled = true;
  decisionResult.hidden = false;
  decisionResult.className = "decision-result pending";
  decisionResult.textContent =
    decision === "approved"
      ? "⏳ Approved — FormBuddy is now filling out the real application via a live browser session. This can take 1–2 minutes..."
      : "⏳ Recording rejection...";

  try {
    const res = await fetch(`/api/session/${encodeURIComponent(sessionId)}/decide`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision, note: decisionNote.value }),
    });
    if (!res.ok) {
      const err = await res.json();
      decisionResult.className = "decision-result error";
      decisionResult.textContent = "⚠️ " + (err.detail || "Request failed");
      return;
    }
    const data = await res.json();
    if (data.status === "submitted") {
      decisionResult.className = "decision-result success";
      decisionResult.textContent = "✅ " + data.message;
    } else if (data.status === "rejected") {
      decisionResult.className = "decision-result pending";
      decisionResult.textContent = "❌ " + data.message;
    } else {
      decisionResult.className = "decision-result error";
      decisionResult.textContent = "⚠️ " + data.message;
    }
  } catch (err) {
    decisionResult.className = "decision-result error";
    decisionResult.textContent = "⚠️ " + err;
  } finally {
    refreshActivity();
    refreshSession(); // re-render from authoritative server state (hides actions once resolved)
  }
}

approveBtn.addEventListener("click", () => decide("approved"));
rejectBtn.addEventListener("click", () => decide("rejected"));

const ACTION_LABELS = {
  fields_matched: "🔎 Read the form and matched your details",
  form_fill_proposed: "📋 Proposed a submission",
  submission_approved: "✅ Human approved",
  submission_rejected: "❌ Human rejected",
  submission_completed: "🎉 Submission completed",
  submission_failed: "⚠️ Submission failed",
};

async function refreshActivity() {
  const res = await fetch(`/api/session/${encodeURIComponent(sessionId)}/audit`);
  const entries = await res.json();
  activityLog.innerHTML = "";
  for (const e of entries) {
    const li = document.createElement("li");
    const label = ACTION_LABELS[e.action] || e.action;
    const time = new Date(e.timestamp * 1000).toLocaleTimeString();
    li.innerHTML = `<span class="actor">${e.actor === "agent" ? "🤖" : "🧑"}</span> <span class="action">${label}</span><span class="time">${time}</span>`;
    activityLog.appendChild(li);
  }
}

document.getElementById("new-session-btn").addEventListener("click", () => {
  // A session_id can only ever be proposed on once (propose_application
  // refuses to overwrite a decided session -- see agent/tools/proposal.py).
  // The only way to start a genuinely new conversation is a fresh id.
  if (!confirm("Start a new conversation? This clears the current chat and proposal from view (nothing is deleted server-side).")) {
    return;
  }
  localStorage.removeItem(SESSION_KEY);
  window.location.reload();
});

// Initial load: greet + sync any existing session state (e.g. after a page refresh).
addMessage(
  "Namaste! I'm FormBuddy (Good Neighbor). Give me a link to a ward letter, scholarship, or community form and I'll read the real form, draft exactly what I'd submit from your saved profile, and wait for your approval before anything is sent. I ask one missing detail at a time like ChatGPT and remember it for next time. For cooperatives: paste the form URL once, it helps everyone in the batch.",
  "agent"
);
refreshSession();
refreshActivity();
syncProfileFromServer();
