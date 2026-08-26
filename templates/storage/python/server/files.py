"""A worked example of the storage layer: upload a file, list what's there,
and hand out a link to one.

Copy the shape, or delete this file and its two lines in main.py.
"""

from uuid import uuid4

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import RedirectResponse

from storage import BUCKET, s3

router = APIRouter()

# In memory, then straight on to the store. Anything much larger than this
# wants streaming instead, which is a different and longer piece of code.
MAX_BYTES = 25 * 1024 * 1024


@router.post("/api/files", status_code=201)
async def upload_file(file: UploadFile = File(...)):
    body = await file.read()
    if len(body) > MAX_BYTES:
        raise HTTPException(status_code=413, detail="file is larger than 25 MB")

    # The name a browser sends is not unique and not always safe; the key is.
    key = f"{uuid4()}-{file.filename}"
    s3.put_object(
        Bucket=BUCKET,
        Key=key,
        Body=body,
        ContentType=file.content_type or "application/octet-stream",
    )
    return {"key": key, "size": len(body)}


@router.get("/api/files")
def list_files():
    listed = s3.list_objects_v2(Bucket=BUCKET)
    return [
        {
            "key": object["Key"],
            "size": object["Size"],
            "updatedAt": object["LastModified"],
        }
        for object in listed.get("Contents", [])
    ]


@router.get("/api/files/{key}")
def download_file(key: str):
    """A signed URL rather than the bytes: the browser fetches from the store
    itself, the server never proxies the download, and the link expires."""
    url = s3.generate_presigned_url(
        "get_object", Params={"Bucket": BUCKET, "Key": key}, ExpiresIn=3600
    )
    return RedirectResponse(url)
