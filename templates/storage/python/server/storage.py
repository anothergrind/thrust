"""The S3 client, and the bucket it expects to find.

S3 here is the protocol: the same code reaches MinIO, Cloudflare R2 or S3
itself, and which one is decided by S3_ENDPOINT in .env.
"""

import os
import time

import boto3
from botocore.exceptions import BotoCoreError, ClientError

BUCKET = os.getenv("S3_BUCKET", "__BUCKET_NAME__")

# Only S3-compatible stores need an endpoint; S3 itself is found from the
# region. Emptying S3_ENDPOINT is what moves you from MinIO to AWS.
ENDPOINT = os.getenv("S3_ENDPOINT") or None

s3 = boto3.client(
    "s3",
    endpoint_url=ENDPOINT,
    region_name=os.getenv("AWS_REGION", "us-east-1"),
)


def ensure_bucket() -> None:
    """Creates the bucket unless it is already there.

    The retries are for the seconds after `npm run docker:up` in which MinIO is
    running but not yet answering.
    """
    for attempt in range(5):
        try:
            s3.head_bucket(Bucket=BUCKET)
            return
        except ClientError as error:
            if error.response["Error"]["Code"] in ("404", "NoSuchBucket"):
                s3.create_bucket(Bucket=BUCKET)
                return
            if attempt == 4:
                raise
        except BotoCoreError:
            if attempt == 4:
                raise
        time.sleep(1)
