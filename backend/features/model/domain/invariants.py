from __future__ import annotations


class ModelDefinitionError(ValueError):
    pass


class NotFoundError(ModelDefinitionError):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ModelDefinitionError(message)
