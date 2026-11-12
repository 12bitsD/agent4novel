from resource_fixtures import EXTENSION_REQUEST_ID, WORK_ID

from agent4novel.domain.diagnostics import TelemetryBuffer


def telemetry(attempt: str) -> dict[str, object]:
    return {
        "requestId": EXTENSION_REQUEST_ID,
        "stepId": "caption",
        "attemptId": attempt,
        "model": "kimi:kimi-k2.8-highspeed",
        "ok": True,
        "latencyMs": 1,
        "promptChars": 10,
        "promptHash": "prompt-hash",
        "systemHash": "system-hash",
    }


def test_buffer_filters_and_retains_bounded_windows() -> None:
    buffer = TelemetryBuffer()
    for index in range(1001):
        buffer.record_telemetry(WORK_ID, telemetry(f"attempt-{index}"))
    for index in range(2):
        buffer.record_command(
            WORK_ID,
            {
                "command": {"requestId": EXTENSION_REQUEST_ID, "attemptIds": [f"attempt-{index}"]},
                "code": "ok",
                "recordedAt": "2026-01-01T00:00:00.000Z",
            },
        )

    response = buffer.diagnostics_for(WORK_ID)
    assert len(response.telemetry) == 1000
    assert response.window.llm.oldestSeq == 2
    assert response.window.llm.latestSeq == 1001
    assert response.window.llm.truncated is True
    assert response.window.commands.oldestSeq == 1
    assert response.window.commands.latestSeq == 2

    for index in range(2):
        buffer.record_telemetry("other-work", telemetry(f"other-{index}"))
    filtered = buffer.diagnostics_for(WORK_ID, EXTENSION_REQUEST_ID, "attempt-999")
    assert [entry.attemptId for entry in filtered.telemetry] == ["attempt-999"]
    commands = buffer.diagnostics_for(WORK_ID, EXTENSION_REQUEST_ID, "attempt-1")
    assert len(commands.commands) == 1
    assert len(buffer.telemetry_for(WORK_ID, after_sequence=1000)) == 1
    assert buffer.telemetry_for("missing") == []
