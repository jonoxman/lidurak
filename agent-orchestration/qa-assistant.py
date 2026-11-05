#!/usr/bin/env python3
import os
import re
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
REVIEWS_DIR = PROJECT_ROOT / ".reviews"
FEEDBACK_FILE = PROJECT_ROOT / "FEEDBACK.md"
ACTIVE_SPEC_FILE = REVIEWS_DIR / "active_feedback_resolved.md"
DEFERRED_FILE = REVIEWS_DIR / "deferred_feedback_items.md"
QUESTIONS_RAW_FILE = REVIEWS_DIR / "ambiguity_questions_raw.txt"


def parse_questions(raw_text: str):
    if "===NO_QUESTIONS===" in raw_text and "===QUESTION:" not in raw_text:
        return []
    questions = []
    pattern = re.compile(
        r"===QUESTION:(Q\d+)\|ITEM:([^=]+)===\s*(.*?)(?=(?:===QUESTION:|===END_OF_QUESTIONS===|$))",
        re.DOTALL,
    )
    for match in pattern.finditer(raw_text):
        qid = match.group(1).strip()
        item_ref = match.group(2).strip()
        body = match.group(3).strip()
        orig_match = re.search(r"ORIGINAL_REQUEST:\s*(.*?)(?=\nAMBIGUITY:|\Z)", body, re.DOTALL)
        amb_match = re.search(r"AMBIGUITY:\s*(.*?)(?=\nOPTIONS:|\Z)", body, re.DOTALL)
        opt_match = re.search(r"OPTIONS:\s*(.*)", body, re.DOTALL)
        questions.append(
            {
                "id": qid,
                "num": qid.lstrip("Qq"),
                "item": item_ref,
                "original": orig_match.group(1).strip() if orig_match else body,
                "ambiguity": amb_match.group(1).strip() if amb_match else body,
                "options": opt_match.group(1).strip() if opt_match else "",
                "status": "pending",  # pending | answered | deferred
                "answer": "",
            }
        )
    return questions


def print_board(questions):
    print("\n" + "=" * 70)
    print("🤔 ORCHESTRATOR CLARIFICATION QUESTIONS (Answer in ANY order or defer)")
    print("=" * 70)
    for q in questions:
        badge = "⏳ [PENDING]"
        if q["status"] == "answered":
            badge = f"✅ [ANSWERED: {q['answer']}]"
        elif q["status"] == "deferred":
            badge = "📌 [DEFERRED TO FEEDBACK.md FOR LATER]"

        print(f"\n  [{q['id']}] (Feedback Item #{q['item']}) {badge}")
        print(f"      Original Request : {q['original']}")
        print(f"      Question         : {q['ambiguity']}")
        if q["options"]:
            print(f"      Suggested Options: {q['options']}")
    print("\n" + "-" * 70)
    print("Commands:")
    print("  • '<#>: <your answer>' -> Answer question # (e.g., '2: Use a 3-second delay')")
    print("  • '<#>: defer'         -> Defer question # back to FEEDBACK.md for a future round")
    print("  • 'defer all'          -> Defer all remaining pending questions to FEEDBACK.md")
    print("  • 'go'                 -> Proceed immediately (any remaining pending questions are deferred)")
    print("-" * 70)


def run_interactive_triage():
    if not QUESTIONS_RAW_FILE.exists():
        sys.exit(0)

    raw_text = QUESTIONS_RAW_FILE.read_text(encoding="utf-8", errors="replace")
    questions = parse_questions(raw_text)
    original_feedback = ""
    if (PROJECT_ROOT / "FEEDBACK.in_progress.md").exists():
        original_feedback = (PROJECT_ROOT / "FEEDBACK.in_progress.md").read_text(encoding="utf-8", errors="replace")
    elif FEEDBACK_FILE.exists():
        original_feedback = FEEDBACK_FILE.read_text(encoding="utf-8", errors="replace")

    if not questions:
        ACTIVE_SPEC_FILE.write_text(original_feedback, encoding="utf-8")
        print("✅ No ambiguities detected in FEEDBACK.md! Proceeding straight to ticket generation.")
        sys.exit(0)

    # Notify the human via single-latch email if they are away from the terminal
    notify_script = PROJECT_ROOT / "agent-orchestration" / "notify.sh"
    if notify_script.exists():
        os.system(
            f'"{notify_script}" "Clarification Questions on FEEDBACK.md" '
            f'"The Architect identified {len(questions)} clarifying question(s) on your FEEDBACK.md items. '
            f'Please check Window 1 to answer in any order or type defer."'
        )

    while True:
        print_board(questions)
        if all(q["status"] != "pending" for q in questions):
            choice = input("All questions addressed! Press [ENTER] or type 'go' to start building (or '<#>: ...' to edit): ").strip()
            if choice == "" or choice.lower() == "go":
                break
        else:
            choice = input("Enter command ('<#>: <answer>', '<#>: defer', 'defer all', or 'go'): ").strip()

        if not choice:
            continue

        if choice.lower() == "go":
            for q in questions:
                if q["status"] == "pending":
                    q["status"] = "deferred"
            break

        if choice.lower() == "defer all":
            for q in questions:
                if q["status"] == "pending":
                    q["status"] = "deferred"
            continue

        # Match 'defer 2' or 'Q2: ...' or '2: ...'
        defer_short = re.match(r"^defer\s+[Qq]?(\d+)$", choice, re.IGNORECASE)
        if defer_short:
            target_num = defer_short.group(1)
            for q in questions:
                if q["num"] == target_num:
                    q["status"] = "deferred"
                    q["answer"] = ""
            continue

        ans_match = re.match(r"^[Qq]?(\d+)\s*[:=-]\s*(.+)$", choice)
        if ans_match:
            target_num = ans_match.group(1)
            val = ans_match.group(2).strip()
            found = False
            for q in questions:
                if q["num"] == target_num:
                    found = True
                    if val.lower() == "defer":
                        q["status"] = "deferred"
                        q["answer"] = ""
                    else:
                        q["status"] = "answered"
                        q["answer"] = val
            if not found:
                print(f"⚠️  No question with number {target_num} found.")
            continue

        print("⚠️  Unrecognized format. Use '<#>: <your answer>', '<#>: defer', 'defer all', or 'go'.")

    # Re-arm notification latch since human just interacted
    latch = REVIEWS_DIR / "alert_sent.latch"
    if latch.exists():
        latch.unlink()

    # Compile active resolved specification for the Architect
    answered = [q for q in questions if q["status"] == "answered"]
    deferred = [q for q in questions if q["status"] == "deferred"]

    resolved_spec = original_feedback + "\n\n"
    if answered:
        resolved_spec += "## HUMAN CLARIFICATIONS (MANDATORY OVERRIDES)\n"
        for q in answered:
            resolved_spec += (
                f"- **Regarding Item #{q['item']} ({q['original']}):**\n"
                f"  - Question: {q['ambiguity']}\n"
                f"  - Human Decision: **{q['answer']}** (Implement this exact behavior).\n"
            )

    if deferred:
        resolved_spec += "\n## DEFERRED ITEMS (DO NOT IMPLEMENT IN THIS RUN)\n"
        resolved_spec += "The human explicitly deferred the following items to a future round. Do NOT generate tickets for these deferred items in this batch:\n"
        for q in deferred:
            resolved_spec += f"- **SKIP Item #{q['item']}:** {q['original']}\n"

        # Save deferred items to be written back into FEEDBACK.md
        deferred_md = (
            "<!-- Write your plain-English UI/UX feedback, bugs, or usability requests below this line. -->\n"
            "<!-- Note: Your previous feedback is always backed up in FEEDBACK.backup.md and .reviews/feedback_archive/ -->\n\n"
            "# Deferred Items from Previous Round (Amend or Answer Below When Ready)\n\n"
        )
        for idx, q in enumerate(deferred, 1):
            deferred_md += (
                f"{idx}. {q['original']}\n"
                f"   - **[ORCHESTRATOR QUESTION TO RESOLVE]:** {q['ambiguity']}\n"
            )
            if q["options"]:
                deferred_md += f"   - **[SUGGESTED OPTIONS]:** {q['options']}\n"
            deferred_md += "   - **[YOUR DECISION]:** \n\n"
        DEFERRED_FILE.write_text(deferred_md, encoding="utf-8")
    else:
        if DEFERRED_FILE.exists():
            DEFERRED_FILE.unlink()

    ACTIVE_SPEC_FILE.write_text(resolved_spec, encoding="utf-8")
    print(
        f"\n✅ Triage complete: {len(answered)} answered, {len(deferred)} deferred to FEEDBACK.md."
    )




def strip_markdown_to_plain(text: str) -> str:
    """Strips Markdown symbols (#, **, `, ~~~) into clean human-readable plain text."""
    lines = []
    for raw_line in text.splitlines():
        line = raw_line.rstrip()
        if line.strip().startswith(("```", "~~~", "===END_OF_FILES===")):
            continue
        # Remove backticks and bold/italic markers
        line = re.sub(r"`([^`]+)`", r"'\1'", line)
        line = re.sub(r"\*\*([^*]+)\*\*", r"\1", line)
        line = re.sub(r"__([^_]+)__", r"\1", line)
        # Convert Markdown headers into clean uppercase section titles
        h_match = re.match(r"^(#{1,6})\s+(.*)", line)
        if h_match:
            level = len(h_match.group(1))
            title = h_match.group(2).strip()
            if level <= 2:
                lines.append("")
                lines.append(title.upper())
                lines.append("-" * min(len(title), 72))
            else:
                lines.append("")
                lines.append(f"[{title}]")
            continue
        # Normalize unordered bullets
        line = re.sub(r"^(\s*)[-*+]\s+", r"\1• ", line)
        lines.append(line)
    return "\n".join(lines).strip() + "\n"


def render_playbook_to_terminal(raw_text: str):
    """Renders the playbook to stdout with clean terminal colors, indentation, and word wrapping."""
    import shutil, textwrap
    width = min(max(shutil.get_terminal_size((90, 24)).columns - 4, 68), 100)

    BOLD = "\033[1m"
    GREEN = "\033[1;32m"
    CYAN = "\033[1;36m"
    YELLOW = "\033[1;33m"
    DIM = "\033[2m"
    RESET = "\033[0m"

    print("\n" + GREEN + "═" * width + RESET)
    print(GREEN + " 🧪 INTERACTIVE QA PLAYBOOK — HOW TO VERIFY RECENT CHANGES" + RESET)
    print(GREEN + "═" * width + RESET)

    for raw_line in raw_text.splitlines():
        line = raw_line.rstrip()
        if not line.strip():
            print("")
            continue
        if line.strip().startswith(("```", "~~~", "===END_OF_FILES===")):
            continue

        # Highlight inline code/buttons in cyan and bold text in bright white/yellow without symbols
        def colorize_inline(s: str) -> str:
            s = re.sub(r"`([^`]+)`", f"{CYAN}\1{RESET}", s)
            s = re.sub(r"\*\*([^*]+)\*\*", f"{BOLD}\1{RESET}", s)
            return s

        h_match = re.match(r"^(#{1,6})\s+(.*)", line)
        if h_match:
            level = len(h_match.group(1))
            title = re.sub(r"[*`]", "", h_match.group(2).strip())
            if level <= 2:
                print(f"\n{YELLOW}{title.upper()}{RESET}")
                print(DIM + "─" * min(len(title) + 4, width) + RESET)
            else:
                print(f"\n{GREEN}▶ {title}{RESET}")
            continue

        # Handle bullet points and numbered steps with clean hanging indents
        bullet_match = re.match(r"^(\s*)(?:[-*+]|•)\s+(.*)", line)
        num_match = re.match(r"^(\s*)(\d+\.)\s+(.*)", line)

        if bullet_match:
            indent_len = len(bullet_match.group(1))
            content = bullet_match.group(2).strip()
            prefix = "  " * (indent_len // 2) + "  • "
            sub_indent = " " * len(prefix)
            wrapped = textwrap.fill(content, width=width, initial_indent=prefix, subsequent_indent=sub_indent)
            print(colorize_inline(wrapped))
        elif num_match:
            indent_len = len(num_match.group(1))
            num_label = num_match.group(2)
            content = num_match.group(3).strip()
            prefix = "  " * (indent_len // 2) + f"    {num_label} "
            sub_indent = " " * len(prefix)
            wrapped = textwrap.fill(content, width=width, initial_indent=prefix, subsequent_indent=sub_indent)
            print(colorize_inline(wrapped))
        else:
            wrapped = textwrap.fill(line.strip(), width=width, initial_indent="  ", subsequent_indent="  ")
            print(colorize_inline(wrapped))

    print(GREEN + "═" * width + RESET + "\n")


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--render-playbook":
        raw_pb = (REVIEWS_DIR / "QA_PLAYBOOK.raw.md").read_text(encoding="utf-8", errors="replace") if (REVIEWS_DIR / "QA_PLAYBOOK.raw.md").exists() else ""
        if raw_pb:
            plain_pb = strip_markdown_to_plain(raw_pb)
            (REVIEWS_DIR / "QA_PLAYBOOK.md").write_text(plain_pb, encoding="utf-8")
            render_playbook_to_terminal(raw_pb)
    elif len(sys.argv) > 1 and sys.argv[1] == "--show-playbook":
        raw_pb = (REVIEWS_DIR / "QA_PLAYBOOK.raw.md").read_text(encoding="utf-8", errors="replace") if (REVIEWS_DIR / "QA_PLAYBOOK.raw.md").exists() else ((REVIEWS_DIR / "QA_PLAYBOOK.md").read_text(encoding="utf-8", errors="replace") if (REVIEWS_DIR / "QA_PLAYBOOK.md").exists() else "")
        if raw_pb:
            render_playbook_to_terminal(raw_pb)
        else:
            print("ℹ️  No QA Playbook generated yet.")
    else:
        run_interactive_triage()
