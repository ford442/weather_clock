#!/usr/bin/env python3
"""
project_deploy_template.py

Copy this file into your project as `deploy.py` (or deploy_contabo.py).
Customize the constants at the top for your project.

Usage:
  1. Build your project:  npm run build   (or python build, etc.)
  2. python deploy.py

This script contacts https://storage.noahcohn.com (your Contabo storage manager)
to upload your entire build as a single zip archive.  The server extracts it and
pushes all files over one persistent SFTP connection — much faster than uploading
files individually.

Actual FTP/SFTP credentials never leave the VPS.

Requirements:
  pip install requests
"""

import argparse
import io
import os
import sys
import zipfile
from pathlib import Path
from typing import Optional

# ============================================================
# PER-PROJECT CONFIGURATION - EDIT THESE
# ============================================================
PROJECT_NAME: str = 'weather-clock'
BUILD_DIR: str = 'dist'
CONTABO_BASE_URL: str = "https://storage.noahcohn.com"
DEPLOY_FOLDER: str = ""  # override remote target folder; empty = use PROJECT_NAME

# Required deploy token for uploads.
# Set via environment: export DEPLOY_TOKEN="your_long_token_from_vps_env"
DEPLOY_TOKEN: Optional[str] = os.environ.get("DEPLOY_TOKEN")
# ============================================================


def build_zip(build_path: Path) -> bytes:
    """Zip the contents of build_path into an in-memory archive."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for file in sorted(build_path.rglob("*")):
            if file.is_dir():
                continue
            rel = file.relative_to(build_path)
            # Skip common junk
            parts = rel.parts
            if any(p in (".git", "node_modules", "__pycache__") for p in parts):
                continue
            zf.write(file, str(rel))
            print(f"  + {rel}")
    return buf.getvalue()


def prepare_bundle(build_path: Path) -> bytes:
    """Zip the build directory and print archive metadata."""
    print("Building zip archive...")
    zip_bytes = build_zip(build_path)
    print(f"Archive size: {len(zip_bytes) / 1024:.1f} KB\n")
    return zip_bytes


def deploy_bundle(build_path: Path, deploy_token: str) -> bool:
    """Zip the build and upload it as a single bundle."""
    import requests

    target_folder = DEPLOY_FOLDER or PROJECT_NAME
    url = f"{CONTABO_BASE_URL}/api/deploy/{PROJECT_NAME}/bundle"
    headers = {"X-Deploy-Token": deploy_token}

    zip_bytes = prepare_bundle(build_path)

    print("Uploading bundle...")
    try:
        response = requests.post(
            url,
            files={"bundle": ("build.zip", zip_bytes, "application/zip")},
            data={"target_folder": target_folder},
            headers=headers,
            timeout=300,
        )
    except Exception as exc:
        print(f"  \u2717 Upload exception: {exc}")
        return False

    if response.status_code == 200:
        data = response.json()
        print(f"  \u2713 {data.get('uploaded', 0)} files uploaded")
        if data.get("failed"):
            print("  Failures:")
            for f in data["failed"]:
                print(f"    \u2717 {f['path']}: {f['error']}")
        return not data.get("failed")
    else:
        print(f"  \u2717 {response.status_code}: {response.text[:400]}")
        return False


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Upload the production build as a bundle to the Contabo deploy service.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Build the deployment zip only; do not upload or require DEPLOY_TOKEN.",
    )
    return parser.parse_args()


def main():
    args = parse_args()
    print(f"\n=== Deploying '{PROJECT_NAME}' via Contabo -> storage.1ink.us ===\n")

    if not args.dry_run and not DEPLOY_TOKEN:
        print("ERROR: DEPLOY_TOKEN is required for deployment.")
        print('Set it in your environment, for example: export DEPLOY_TOKEN="your_deploy_token"')
        print("Use --dry-run to build the zip archive without uploading.")
        sys.exit(1)

    build_path = Path(BUILD_DIR)
    if not build_path.exists() or not build_path.is_dir():
        print(f"ERROR: Build directory '{BUILD_DIR}/' does not exist.")
        print("Please run your build command first (e.g. `npm run build`).")
        sys.exit(1)

    if args.dry_run:
        prepare_bundle(build_path)
        print("Dry run complete. No upload attempted.")
        sys.exit(0)

    import requests

    try:
        health = requests.get(f"{CONTABO_BASE_URL}/api/deploy/health", timeout=10)
        if health.status_code == 200:
            print(f"Contabo deploy service: {health.json().get('status', 'unknown')}")
    except Exception:
        print("Warning: Could not contact storage.noahcohn.com (continuing anyway).")

    print()
    success = deploy_bundle(build_path, DEPLOY_TOKEN)

    print(f"\n=== {'Deployment complete' if success else 'Deployment finished with errors'} ===")
    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()
