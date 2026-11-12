from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.bootstrap import bootstrap_application
from app.config import get_settings
from app.logging import configure_logging
from app.middleware import LocalhostBlockMiddleware
from app.router import api_router


@asynccontextmanager
async def lifespan(_: FastAPI):
    configure_logging()
    bootstrap_application()
    yield


def create_app() -> FastAPI:
    settings = get_settings()

    app = FastAPI(
        title=settings.app_name,
        version=settings.app_version,
        lifespan=lifespan,
    )
    
    # CORSMiddleware must be added LAST so LocalhostBlockMiddleware is outermost
    # and runs FIRST on every request (including CORS preflights).
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.allowed_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.add_middleware(
        LocalhostBlockMiddleware,
        whitelist=settings.localhost_ip_whitelist,
    )

    app.include_router(api_router, prefix=settings.api_prefix)
    return app


app = create_app()
