"""Form inspection tools — two variants, one shared output shape.

inspect_form: the cloud path — visits an arbitrary URL via AgentCore
Browser and reads back its form structure. No pre-built map; the agent
discovers field labels, types, and selectors live from whatever HTML the
page actually returns.

inspect_provided_html: the Chrome-extension path — same discovery job, but
the HTML is handed to it directly (the extension's content script already
read the user's open tab) instead of fetched by driving a remote browser.
No AgentCore Browser dependency at all for this path.

Both are isolated Strands Agents, same pattern as document_parser's vision
extractor — callback_handler=None because tool-call chatter isn't
user-facing. Both are direct @tool functions (unlike form_filler) since
they're read-only — no approval boundary to protect.

Deliberate scope limits, stated rather than silently assumed:
  - Reads the FIRST <form> found on the page. Multi-form pages (e.g. a
    search box plus the actual RSVP form) may need a hint; not handled.
  - No login walls, no CAPTCHA solving, no JS-heavy SPA forms that render
    fields after complex interaction. Static/server-rendered forms only.
  - Neither fills or submits anything -- read-only.

Cost note: both inspectors run on Haiku, not the default Sonnet. Reading
labels/types/selectors out of HTML is structured extraction, not judgment
-- it doesn't need a frontier model, and inspect_form's browser-driving
loop in particular racks up many sequential calls (one per browser action),
each at Sonnet's 5x-pricier output-token rate otherwise. The orchestrator
itself (agent/orchestrator.py) stays on the default model -- that's where
matching a form against a real person's info under ambiguity actually
needs the stronger model.
"""

_HAIKU_MODEL_ID = "us.anthropic.claude-haiku-4-5-20251001-v1:0"

import json
from typing import Any

from strands import Agent, tool

_FIELD_SCHEMA_INSTRUCTIONS = """\
For every field, determine:
  - label: the human-readable label (from an associated <label>, aria-label, \
    placeholder, or nearby text -- best guess if ambiguous)
  - field_type: one of "text", "email", "tel", "number", "date", \
    "textarea", "select", "checkbox"
  - selector: a CSS selector you could use to target this exact element -- \
    strongly prefer "#id" if the element has an id, otherwise a \
    name= attribute selector, otherwise the most specific selector you can \
    construct
  - options: for "select" fields, the list of visible option text values; \
    null for everything else
  - required: true if the element has a required attribute or is visually/\
    textually marked required (e.g. an asterisk)

Also identify submit_selector: a CSS selector for the form's submit \
button.

Respond with ONLY a single JSON object, no prose, no markdown fence:
{"ok": true|false, "fields": [{"label": "...", "field_type": "...", \
"selector": "...", "options": null, "required": true|false}, ...], \
"submit_selector": "...", "notes": "<anything unusual: no form found, \
login wall, CAPTCHA, JS-rendered content that didn't load, etc>"}

If you cannot find a usable form, set "ok": false and explain why in \
notes -- do not invent fields that aren't really there.
"""

_INSPECTOR_PROMPT = f"""\
You are inspecting a web form, not filling it out. Navigate to the given \
URL (use init_session first, then navigate), then use get_html to read the \
page's HTML source. Find the first <form> on the page (or the most \
prominent set of input fields if there's no explicit <form> tag).

{_FIELD_SCHEMA_INSTRUCTIONS}
(For this cloud path, "no usable form" also covers: login required, \
CAPTCHA present, page didn't load.)
"""

_HTML_INSPECTOR_PROMPT = f"""\
You are inspecting HTML from a web form. This HTML was NOT fetched by \
you — it was read directly from the user's own open browser tab by a \
Chrome extension and handed to you as text. Do not attempt to navigate \
anywhere; just read the given HTML. Find the first <form> in it (or the \
most prominent set of input fields if there's no explicit <form> tag).

Special handling for Google Forms (docs.google.com/forms): the real \
fields are inputs with name="entry.XXXXXXX" (often inside div[role=listitem]), \
and the visible textbox may be div[role=textbox] or textarea. Always \
return selector '[name="entry.XXXXXXX"]' for those (strongly preferred \
over a generated id), and map the visible question text as label. For \
selects, the options are div[role=option] text.

{_FIELD_SCHEMA_INSTRUCTIONS}
"""


def _parse_json(raw_text: str) -> dict[str, Any]:
    text = raw_text.strip()
    if text.startswith("```"):
        text = text.strip("`")
        if text.lower().startswith("json"):
            text = text[4:].strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    start, end = text.find("{"), text.rfind("}")
    if start != -1 and end != -1 and end > start:
        return json.loads(text[start : end + 1])
    raise json.JSONDecodeError("no JSON object found in model output", text, 0)


def _inspection_result_from_response(response: Any) -> dict[str, Any]:
    """Shared shape-normalization for both inspect_form and
    inspect_provided_html — same parsing, same fallback on bad output."""
    try:
        result = _parse_json(str(response))
    except json.JSONDecodeError:
        return {
            "ok": False,
            "fields": [],
            "submit_selector": None,
            "notes": f"Inspector did not return valid JSON: {str(response)[:500]!r}",
        }

    return {
        "ok": bool(result.get("ok", False)),
        "fields": result.get("fields", []),
        "submit_selector": result.get("submit_selector"),
        "notes": result.get("notes", ""),
    }


@tool
def inspect_form(url: str, region: str = "us-east-1") -> dict[str, Any]:
    """Visit url (cloud path, via AgentCore Browser) and return its
    discovered form structure. Use this when you only have a URL and no
    extension has handed you the page's HTML directly — see
    inspect_provided_html for that case.

    Unlike fill_and_submit_form, this IS a direct agent tool — it's
    read-only (never fills or submits anything), so there's no approval
    boundary to protect here, same reasoning as document_parser being a
    direct tool while form_filler is not.

    Returns:
        {"ok": bool, "fields": [...], "submit_selector": str|None,
         "notes": str}
        ok=False (e.g. login wall, CAPTCHA, page didn't load, unparseable
        model output) always comes back structured, never raises.
    """
    from strands_tools.browser import AgentCoreBrowser  # local: heavy dep, see form_filler.py

    browser_tool = AgentCoreBrowser(region=region)
    inspector = Agent(
        system_prompt=_INSPECTOR_PROMPT, tools=[browser_tool.browser], callback_handler=None, model=_HAIKU_MODEL_ID
    )
    try:
        response = inspector(f"Inspect the form at this URL: {url}")
    except Exception as e:
        return {"ok": False, "fields": [], "submit_selector": None, "notes": f"Inspection failed: {e}"}
    finally:
        # Same fix as form_filler.py's fill_and_submit_form -- see that
        # comment for why this matters and why the private _cleanup() is
        # the right call here, not the public `close` action.
        try:
            browser_tool._cleanup()
        except Exception:
            pass
    return _inspection_result_from_response(response)


@tool
def inspect_provided_html(html: str, url: str = "") -> dict[str, Any]:
    """Parse HTML that a Chrome extension already read from the user's own
    open browser tab (extension path — no AgentCore Browser, no network
    fetch of any kind here) and return its discovered form structure. Use
    this instead of inspect_form whenever the conversation already
    contains the page's raw HTML.

    Args:
        html: The page's (or relevant form's) HTML, as provided.
        url: The page's URL, for context/logging only — not fetched.

    Returns:
        Same shape as inspect_form: {"ok": bool, "fields": [...],
        "submit_selector": str|None, "notes": str}.
    """
    inspector = Agent(system_prompt=_HTML_INSPECTOR_PROMPT, callback_handler=None, model=_HAIKU_MODEL_ID)
    response = inspector(f"URL (context only, do not fetch): {url or '(not given)'}\n\nPage HTML:\n{html}")
    return _inspection_result_from_response(response)
