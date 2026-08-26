"""Database setup: one client, one database, and the indexes it needs.

Collections appear the first time you write to them, so there is no schema to
create — indexes are the one thing Mongo won't invent for you, which is what
create_indexes is for. Models live in items.py, as plain dictionaries going in
and Pydantic models coming out.
"""

import os

from pymongo import ASCENDING, MongoClient

DATABASE_URL = os.getenv("DATABASE_URL", "__DB_URL__")

client = MongoClient(DATABASE_URL)

# The database named in the URL's path, so that one variable says both where to
# connect and which database to use — as it does for every other engine here.
db = client.get_default_database(default="__PROJECT_NAME__")
items = db["items"]


def create_indexes() -> None:
    items.create_index([("created_at", ASCENDING)])
