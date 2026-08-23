"""Database setup: one engine, one session factory, one declarative base.

Models live in models.py. Tables are created on startup, which is what you
want while the shape is still moving; swap in Alembic once it isn't.
"""

import os

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

DATABASE_URL = os.getenv("DATABASE_URL", "__DB_URL__")

# check_same_thread is a SQLite-only knob: FastAPI serves requests from a
# thread pool, and SQLite refuses cross-thread connections without it.
connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}

engine = create_engine(DATABASE_URL, connect_args=connect_args)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


class Base(DeclarativeBase):
    pass


def get_session():
    """FastAPI dependency: one session per request, always closed."""
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


def create_tables() -> None:
    from models import Item  # noqa: F401  (registers the model with Base)

    Base.metadata.create_all(engine)
