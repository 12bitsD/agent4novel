from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

SafeInt = Annotated[int, Field(gt=0, le=9_007_199_254_740_991)]
SafeCount = Annotated[int, Field(ge=0, le=9_007_199_254_740_991)]


def is_absent(value: object) -> bool:
    return value is None


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")

    @model_validator(mode="before")
    @classmethod
    def reject_explicit_null_for_omitted_fields(cls, value: Any) -> Any:
        if isinstance(value, dict):
            for name, field in cls.model_fields.items():
                if field.exclude_if is is_absent and name in value and value[name] is None:
                    raise ValueError(f"{name} may be omitted but not null")
        return value


class TrimmedModel(StrictModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class HealthResponse(StrictModel):
    status: Literal["ok"]


class AppConfigResponse(StrictModel):
    demo: bool
