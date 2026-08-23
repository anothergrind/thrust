"""A worked example of the database layer: list and create rows.

Copy the shape for your own models, or delete this file and its two lines in
main.py.
"""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from db import get_session
from models import Item

router = APIRouter()


class ItemIn(BaseModel):
    name: str


class ItemOut(BaseModel):
    id: int
    name: str

    model_config = {"from_attributes": True}


@router.get("/api/items", response_model=list[ItemOut])
def list_items(session: Session = Depends(get_session)):
    return session.scalars(select(Item).order_by(Item.id)).all()


@router.post("/api/items", response_model=ItemOut, status_code=201)
def create_item(payload: ItemIn, session: Session = Depends(get_session)):
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="name is required")

    item = Item(name=name)
    session.add(item)
    session.commit()
    session.refresh(item)
    return item
