# Thin wrapper around the official Skyvern API image.
# See `patch-local-storage-share.py` for why the patch exists.
FROM public.ecr.aws/skyvern/skyvern:latest

COPY patch-local-storage-share.py /tmp/patch-local-storage-share.py
RUN python3 /tmp/patch-local-storage-share.py && rm /tmp/patch-local-storage-share.py
