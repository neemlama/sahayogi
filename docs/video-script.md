# Video Script — 5 min max (Good Neighbor track)

**Goal:** Show judges in one take: problem → who → why it matters → live E2E in both modes → safety. Record locally + one ephemeral AgentCore Browser run (~$0.10). Keep under 5:00.

## 0:00–0:25 Problem & Who (25s)
> “In Nepal, a student like Maya (20, Hetauda) fills the same details — name, citizenship, ward — into 10–15 forms a year: scholarships, ward letters, exam registrations. A cooperative helping 30 families does this ×30. Existing autofill pastes blindly and never asks before submitting.”

Show `README.md:1` header + `docs/architecture.png` for 3s.

## 0:25–0:50 Why FormBuddy matters (25s)
> “FormBuddy is a Good Neighbor agent: it reads the *real* form live, matches it against your saved profile and even a photo of your citizenship/SEE certificate, drafts the exact fill plan, refuses to invent a missing required field, and waits for your approval. ~4 min → 45 sec per form, ~2 hrs saved per 30-family batch.”

Show `COST.md` badge “stays under $20” — cost-conscious.

## 0:50–2:10 Extension mode — primary demo (80s, $0)
1. Open `demo/mock-rsvp/index.html` (ward-style form).
2. Side panel: show saved profile vault `frontend/index.html:21` (also `extension/sidepanel.html`), click **Analyze This Page**.
3. Proposal appears: URL, fields, required `*`, `fill_mode=extension` — point to “fills only, you click Submit”.
4. Click **Authorize & Fill** → form fills in tab, no submit — show `screenshots/extension_filled_form.png` live.
5. Briefly scroll audit `GET /api/session/{id}/audit` — `fields_matched → proposed → approved → completed`.

## 2:10–3:40 Cloud mode — AgentCore Browser proof (90s, ~$0.10)
1. Web UI `http://localhost:8000` (or ephemeral Runtime URL) — show profile vault auto-append.
2. Paste demo URL + “My name is Maya Gurung…” → agent inspects via `inspect_form` (Haiku + AgentCore Browser).
3. Proposal card `frontend/app.js:89` — review table → **Approve & Submit**.
4. Show “Filling via live browser…” → confirmation `RSVP-XXXX` → audit `submission_completed`.

> Voiceover: “Cloud mode drives AgentCore Browser and actually clicks submit only after your approval; extension mode never clicks submit — you do.” Mention `_cleanup()` and Haiku tiering (`form_filler.py:87`).

## 3:40–4:20 Safety & Architecture (40s)
Show `docs/safety.md` flowchart + `docs/architecture.mmd`:
> “No invention of required values (`proposal.py:89` refuses), no submission tool on the agent, every step logged to `audit_log.py`, dual-backend local/DynamoDB, extension vs cloud share the same brain.”

## 4:20–4:55 Impact + Good Neighbor close (35s)
> “For Maya and her co-op, this is a community tool — one trusted agent that handles repetitive paperwork for many, keeps data local until Analyze, and keeps humans in control. Built with Strands Agents SDK, deployed on demand to AgentCore Runtime (ephemeral to protect credits — see COST.md).”

Show `LICENSE` MIT + `uv run pytest` 41 passed + GitHub repo.

## 4:55–5:00 CTA (5s)
> “Repo, architecture, and live demo in the description. Namaste.”

### Recording checklist
- [ ] `uv run pytest -q` green in terminal for 2s
- [ ] Both modes capture audio + captions
- [ ] Show `docs/architecture.png` and `COST.md` on screen
- [ ] Keep Runtime up <30 min, then `docs/deploy.md:4` teardown
