class ConfigInvalidError(ValueError):
    code = "config-invalid"


class AgentFileUnavailableError(ValueError):
    code = "agent-file-unavailable"


class KnownError(ValueError):
    def __init__(
        self,
        code: str,
        message: str,
        *,
        retryable: bool = False,
        attempt_id: str | None = None,
        input_budget: dict[str, object] | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.retryable = retryable
        self.attemptId = attempt_id
        self.inputBudget = input_budget
