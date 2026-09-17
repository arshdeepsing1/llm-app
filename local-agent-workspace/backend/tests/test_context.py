import asyncio
import copy
import json

import pytest

from local_agent.context import (
    DEFAULT_CONTEXT_WINDOW, MAX_CONTEXT_WINDOW, MIN_CONTEXT_WINDOW, REPLY_RESERVE,
    SAFETY_MARGIN, SUMMARY_MAX_BYTES, SUMMARY_PREFIX, build_summary_messages,
    context_messages, estimate_tokens, prepare_context,
)


SYSTEM = {"role": "system", "content": "Follow the user's current request."}
TOOLS = [{"type": "function", "function": {"name": "read_file", "parameters": {"type": "object"}}}]


def user(text):
    return {"role": "user", "content": text}


def assistant(text):
    return {"role": "assistant", "content": text}


def long_history():
    return [user("old " * 7500), assistant("Old work done."),
            user("Previous request"), assistant("Previous answer"), user("Latest request")]


async def forbidden_summary(previous, chunk):
    pytest.fail("Summarization should not run")


def test_estimate_counts_utf8_serialized_request_and_overhead():
    messages = [SYSTEM, user('Unicode: 汉字🙂 and escapes: \\"\n')]
    expected = len(json.dumps({"messages": messages, "tools": TOOLS}, ensure_ascii=False).encode("utf-8")) + 256
    assert estimate_tokens(messages, TOOLS) == expected
    assert estimate_tokens([user("🙂")]) > estimate_tokens([user("x")])


def test_context_messages_adds_historical_summary_without_changing_archive():
    wire = [user("Archived"), assistant("Done"), user("Current")]
    state = {"summary": "Earlier work", "through": 2, "compactions": 1}
    original = copy.deepcopy((wire, state))
    assert context_messages(wire, state) == [user(SUMMARY_PREFIX + "Earlier work"), user("Current")]
    assert context_messages(wire, {}) == wire
    assert (wire, state) == original


async def test_small_context_requires_no_compaction_and_reports_estimated_budget():
    wire = [user("Hello"), assistant("Hi")]
    messages, state, info = await prepare_context(wire, None, SYSTEM, TOOLS, DEFAULT_CONTEXT_WINDOW, forbidden_summary)
    assert messages == [SYSTEM, *wire]
    assert state == {"summary": "", "through": 0, "compactions": 0}
    assert info == {"estimated_tokens": estimate_tokens(messages, TOOLS),
                    "input_budget": DEFAULT_CONTEXT_WINDOW - REPLY_RESERVE - SAFETY_MARGIN,
                    "context_window": DEFAULT_CONTEXT_WINDOW, "reply_reserve": REPLY_RESERVE,
                    "compactions": 0, "summarized_messages": 0, "estimate_method": "conservative_utf8"}


async def test_compaction_keeps_latest_two_turns_and_complete_tool_exchanges():
    wire = long_history()
    wire[3:4] = [
        {"role": "assistant", "content": None, "tool_calls": [{"id": "call-1", "type": "function", "function": {"name": "read_file", "arguments": "{}"}}]},
        {"role": "tool", "tool_call_id": "call-1", "content": "file contents"}, assistant("Previous answer"),
    ]
    wire.extend([
        {"role": "assistant", "content": None, "tool_calls": [{"id": "call-2", "type": "function", "function": {"name": "read_file", "arguments": "{}"}}]},
        {"role": "tool", "tool_call_id": "call-2", "content": "more contents"},
    ])
    state = {"summary": "", "through": 0, "compactions": 0}
    original = copy.deepcopy((wire, state))
    chunks = []

    async def summarize(previous, chunk):
        chunks.append(chunk)
        return "The earlier work is complete."

    messages, updated, info = await prepare_context(wire, state, SYSTEM, TOOLS, DEFAULT_CONTEXT_WINDOW, summarize)
    assert updated["through"] == 2
    assert updated["compactions"] == 1
    assert messages[2:] == wire[2:]
    assert "".join(chunks) == json.dumps(wire[:2], ensure_ascii=False)
    assert info["summarized_messages"] == 2
    assert info["estimated_tokens"] <= info["input_budget"]
    assert (wire, state) == original


async def test_compaction_falls_back_to_latest_turn_when_two_do_not_fit():
    wire = long_history()
    wire[2] = user("p" * 20000)

    async def summarize(previous, chunk):
        return "Earlier requests summarized."

    messages, state, _ = await prepare_context(wire, {}, SYSTEM, TOOLS, DEFAULT_CONTEXT_WINDOW, summarize)
    assert state["through"] == 4
    assert messages[2:] == wire[4:]


@pytest.mark.parametrize("large_system", [False, True])
async def test_no_summary_call_when_latest_turn_or_system_cannot_fit(large_system):
    wire = [user("old"), assistant("answer"), user("x" * (10 if large_system else 30000))]
    system = {"role": "system", "content": "s" * (30000 if large_system else 10)}
    state = {"summary": "", "through": 0, "compactions": 0}
    original = copy.deepcopy((wire, state))
    with pytest.raises(ValueError, match="Increase the context window"):
        await prepare_context(wire, state, system, TOOLS, DEFAULT_CONTEXT_WINDOW, forbidden_summary)
    assert (wire, state) == original


@pytest.mark.parametrize("failure", [RuntimeError("provider failed"), asyncio.CancelledError()])
async def test_failure_after_first_chunk_never_commits_partial_summary(failure):
    wire = [user("already archived"), assistant("done"), user("x" * 60000), assistant("done"),
            user("recent"), assistant("answer"), user("latest")]
    state = {"summary": "Prior summary", "through": 2, "compactions": 3}
    original = copy.deepcopy((wire, state))
    calls = 0

    async def summarize(previous, chunk):
        nonlocal calls
        calls += 1
        if calls == 2:
            raise failure
        return "Intermediate summary"

    expected = asyncio.CancelledError if isinstance(failure, asyncio.CancelledError) else ValueError
    with pytest.raises(expected):
        await prepare_context(wire, state, SYSTEM, TOOLS, DEFAULT_CONTEXT_WINDOW, summarize)
    assert calls == 2
    assert (wire, state) == original


@pytest.mark.parametrize("summary", ["", "  ", None, "x" * (SUMMARY_MAX_BYTES + 1), "🙂" * 876])
async def test_summary_must_be_nonempty_text_within_byte_limit(summary):
    wire, state = long_history(), {}
    original = copy.deepcopy((wire, state))

    async def summarize(previous, chunk):
        return summary

    with pytest.raises(ValueError, match="summary"):
        await prepare_context(wire, state, SYSTEM, TOOLS, DEFAULT_CONTEXT_WINDOW, summarize)
    assert (wire, state) == original


async def test_unicode_and_escaped_chunks_fit_each_summary_request():
    wire = [user('汉字🙂\\"\n' * 2500), assistant("done"), user("recent"), assistant("answer"), user("latest")]
    state = {"summary": "Earlier summary", "through": 0, "compactions": 2}
    chunks = []
    input_budget = MIN_CONTEXT_WINDOW - REPLY_RESERVE - SAFETY_MARGIN

    async def summarize(previous, chunk):
        assert estimate_tokens(build_summary_messages(previous, chunk)) <= input_budget
        chunk.encode("utf-8").decode("utf-8")
        chunks.append(chunk)
        return '事实🙂\\"\n' * 250

    messages, updated, info = await prepare_context(wire, state, SYSTEM, TOOLS, MIN_CONTEXT_WINDOW, summarize)
    assert len(chunks) > 1
    assert "".join(chunks) == json.dumps(wire[:2], ensure_ascii=False)
    assert updated["compactions"] == 3
    assert estimate_tokens(messages, TOOLS) == info["estimated_tokens"] <= input_budget


async def test_repeated_compaction_only_summarizes_newly_archived_messages():
    wire = long_history()
    requests = []

    async def summarize(previous, chunk):
        requests.append((previous, chunk))
        return "All earlier work summarized."

    _, first, _ = await prepare_context(wire, None, SYSTEM, TOOLS, DEFAULT_CONTEXT_WINDOW, summarize)
    requests.clear()
    wire.extend([assistant("last answer"), user("new " * 7000), assistant("done"), user("Final request")])
    original = copy.deepcopy((wire, first))
    messages, second, info = await prepare_context(wire, first, SYSTEM, TOOLS, DEFAULT_CONTEXT_WINDOW, summarize)
    assert first["through"] == 2
    assert second["through"] == 8
    assert second["compactions"] == 2
    assert requests[0][0] == first["summary"]
    assert "".join(chunk for _, chunk in requests) == json.dumps(wire[2:8], ensure_ascii=False)
    assert messages[2:] == wire[8:]
    assert info["summarized_messages"] == 8
    assert (wire, first) == original


async def test_final_serialized_request_is_checked_before_committing_summary():
    wire = long_history()
    wire[2] = user("x" * 18000)
    state = {}
    original = copy.deepcopy((wire, state))

    async def summarize(previous, chunk):
        return "\\" * SUMMARY_MAX_BYTES

    with pytest.raises(ValueError, match="still exceed the context budget"):
        await prepare_context(wire, state, SYSTEM, TOOLS, DEFAULT_CONTEXT_WINDOW, summarize)
    assert (wire, state) == original


@pytest.mark.parametrize("context_window", [MIN_CONTEXT_WINDOW - 1, MAX_CONTEXT_WINDOW + 1])
async def test_invalid_context_window_is_rejected(context_window):
    with pytest.raises(ValueError, match="Choose a context window"):
        await prepare_context([user("Hello")], {}, SYSTEM, TOOLS, context_window, forbidden_summary)
