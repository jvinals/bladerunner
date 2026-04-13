#!/usr/bin/env python3
"""Patch Skyvern LocalStorage in the official API image at build time.

Skyvern UI (artifactUtils.getImageURL) returns `signed_url` before rewriting `uri`.
For local disk storage, `get_share_link` sets `signed_url` to the same `file://`
value as `uri`, so the browser receives `file://` and cannot render screenshots.
Omitting `signed_url` lets the UI rewrite `file://` from `uri` to
`{VITE_ARTIFACT_API_BASE_URL}/artifact/image?path=...` (see upstream
skyvern-frontend/src/routes/tasks/detail/artifactUtils.ts).

Refs: Skyvern LocalStorage.get_share_link / get_share_links in
skyvern/forge/sdk/artifact/storage/local.py
"""
from __future__ import annotations

from pathlib import Path

TARGET = Path("/app/skyvern/forge/sdk/artifact/storage/local.py")


def main() -> None:
    text = TARGET.read_text()
    orig = text

    old1 = """    async def get_share_link(self, artifact: Artifact) -> str | None:
        return artifact.uri if artifact.uri else None"""
    new1 = """    async def get_share_link(self, artifact: Artifact) -> str | None:
        # Bladerunner: omit file:// in signed_url so skyvern-ui rewrites via artifact server.
        return None"""

    old2 = """    async def get_share_links(self, artifacts: list[Artifact]) -> list[str] | None:
        return [artifact.uri for artifact in artifacts] or None"""
    new2 = """    async def get_share_links(self, artifacts: list[Artifact]) -> list[str] | None:
        # Bladerunner: batch endpoint must not populate signed_url with file:// either.
        return None"""

    if old1 not in text:
        raise SystemExit(f"patch failed: get_share_link block not found in {TARGET}")
    if old2 not in text:
        raise SystemExit(f"patch failed: get_share_links block not found in {TARGET}")

    text = text.replace(old1, new1, 1).replace(old2, new2, 1)
    if text == orig:
        raise SystemExit("patch failed: no changes applied")
    TARGET.write_text(text)
    print(f"Patched {TARGET}")


if __name__ == "__main__":
    main()
