import logging
from logging.config import dictConfig

from app.config import get_settings


def configure_logging() -> None:
    """Configure structured-enough console logging for Increment 1."""

    settings = get_settings()

    dictConfig(
        {
            "version": 1,
            "disable_existing_loggers": False,
            "formatters": {
                "default": {
                    "format": (
                        "%(asctime)s | %(levelname)s | %(name)s | "
                        "%(message)s"
                    )
                }
            },
            "handlers": {
                "console": {
                    "class": "logging.StreamHandler",
                    "formatter": "default",
                }
            },
            "root": {
                "level": settings.log_level.upper(),
                "handlers": ["console"],
            },
        }
    )

    logging.getLogger("uvicorn.access").propagate = True
