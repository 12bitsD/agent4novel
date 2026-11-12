from typing import Any

from pydantic import ValidationError

ISSUE_LIMIT = 128


def validation_metadata(error: ValidationError | list[dict[str, Any]]) -> dict[str, Any]:
    if isinstance(error, ValidationError):
        issues = [
            {"path": list(issue["loc"]), "code": issue["type"], "message": "invalid field"}
            for issue in error.errors()
        ]
    else:
        issues = error
    return {
        "issues": issues[:ISSUE_LIMIT],
        "issueCount": len(issues),
        "issuesTruncated": len(issues) > ISSUE_LIMIT,
    }
