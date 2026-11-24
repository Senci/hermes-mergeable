#!/usr/bin/env python3
"""Stand-in for `hermes -p <profile> chat --query-file ...`, installed as <tmp>/bin/hermes by test_audit.

It accepts only the flags the real `hermes chat --help` (Hermes 0.22.5) lists for this call and refuses anything
else with exit 2 like argparse; `-t none` is refused as the real CLI does. The reply goes to stdout alone, and
`Session: <id>`, a blank line and `session_id: <id>` go to stderr, as recorded from a real `-Q` call.
Every call appends one JSON line to $FAKE_HERMES_LOG: argv, the query file's mode and text as read at call time,
and whether the dashboard token leaked into the environment. Replies come from $FAKE_HERMES_SCRIPT:

  {"by_model": {"<model>": [<step>, ...]}, "default": <step>}  (steps are consumed in order, the last repeats)
  step = {"reply": "<stdout text>"} | {"audit": {<fields>}, "read_all": true} | {"exit": 3, "stderr": "..."} | {"sleep": 5}
  "audit" with "read_all" fills releases_read from the tags found in the query's JSON block.
"""

import json
import os
import re
import sys
import time

LOG = os.environ["FAKE_HERMES_LOG"]
SCRIPT = os.environ["FAKE_HERMES_SCRIPT"]
VALUE_FLAGS = {"-p", "--query-file", "-m", "--provider", "--source", "-t"}
BOOL_FLAGS = {"--oneshot", "-Q", "--safe-mode"}
SESSION_ID = "local-" + "0f" * 32


def refuse(message):
    sys.stderr.write(f"hermes: error: {message}\n")
    sys.exit(2)


def parse(argv):
    if len(argv) < 3 or argv[0] != "-p" or argv[2] != "chat":
        refuse("expected: -p <profile> chat ...")
    out = {"profile": argv[1]}
    rest = argv[3:]
    i = 0
    while i < len(rest):
        flag = rest[i]
        if flag in VALUE_FLAGS:
            if i + 1 >= len(rest):
                refuse(f"argument {flag}: expected one argument")
            out[flag] = rest[i + 1]
            i += 2
        elif flag in BOOL_FLAGS:
            out[flag] = True
            i += 1
        else:
            refuse(f"unrecognized arguments: {flag}")
    if out.get("-t") == "none":
        refuse("argument -t/--toolsets: invalid toolset 'none'")
    if "--query-file" not in out:
        refuse("no query")
    return out


def tags_in(text):
    match = re.search(r"<audit-input>\n(.*)\n</audit-input>", text, re.S)
    if not match:
        return []
    doc = json.loads(match.group(1))
    return [r["tag"] for r in doc.get("releases", []) + doc.get("changelog", [])]


def main():
    argv = sys.argv[1:]
    args = parse(argv)
    path = args["--query-file"]
    st = os.stat(path)
    with open(path, encoding="utf-8") as fh:
        text = fh.read()
    model = args.get("-m", "")
    with open(LOG, "a") as log:
        log.write(json.dumps({
            "argv": argv, "profile": args["profile"], "model": model, "toolsets": args.get("-t"), "source": args.get("--source"),
            "query_file": path, "query_mode": oct(st.st_mode & 0o777), "query_text": text,
            "hermes_home": os.environ.get("HERMES_HOME"), "token_leaked": any(k.startswith("HERMES_DASHBOARD") for k in os.environ),
        }) + "\n")
    with open(SCRIPT) as fh:
        script = json.load(fh)
    state_path = SCRIPT + ".state"
    state = json.load(open(state_path)) if os.path.exists(state_path) else {}
    queue = script.get("by_model", {}).get(model)
    step = script.get("default", {})
    if queue:
        index = min(state.get(model, 0), len(queue) - 1)
        step = queue[index]
        state[model] = state.get(model, 0) + 1
        with open(state_path, "w") as fh:
            json.dump(state, fh)
    if step.get("sleep"):
        time.sleep(step["sleep"])
    if step.get("exit"):
        sys.stderr.write(step.get("stderr", "error") + "\n")
        return step["exit"]
    if "audit" in step:
        audit = dict(step["audit"])
        if step.get("read_all"):
            audit["releases_read"] = tags_in(text)
        reply = json.dumps(audit)
    else:
        reply = step.get("reply", "{}")
    sys.stdout.write(reply + "\n")
    sys.stderr.write(f"Session: {SESSION_ID}\n\nsession_id: {SESSION_ID}\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
