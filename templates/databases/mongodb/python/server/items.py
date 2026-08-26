"""A worked example of the database layer: list and create documents.

Copy the shape for your own collections, or delete this file and its two lines
in main.py.
"""

from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from db import items

router = APIRouter()


class ItemIn(BaseModel):
    name: str


class ItemOut(BaseModel):
    id: str
    name: str


def to_item(document) -> ItemOut:
    """Mongo's _id is an ObjectId, and JSON has no such thing."""
    return ItemOut(id=str(document["_id"]), name=document["name"])


@router.get("/api/items", response_model=list[ItemOut])
def list_items():
    return [to_item(document) for document in items.find().sort("created_at", 1)]


@router.post("/api/items", response_model=ItemOut, status_code=201)
def create_item(payload: ItemIn):
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="name is required")

    document = {"name": name, "created_at": datetime.now(timezone.utc)}
    result = items.insert_one(document)
    return to_item({**document, "_id": result.inserted_id})
