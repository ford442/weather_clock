#!/usr/bin/env python3
"""Build and upload the production bundle through the deployment service.

Configuration is read from environment variables first, then from the JSON file
named by DEPLOY_CONFIG (defaults to ``deploy.config.json``). Secret values must
never be committed to this repository.
"""

import io
import json
import os
import sys
import zipfile
from pathlib import Path
from typing import Any

import requests


CONFIG_PATH = Path(os.environ.get("DEPLOY_CONFIG", "deploy.config.json"))


def load_config(path: Path = CONFIG_PATH) -> dict[str, Any]:
    """Load optional local configuration without logging secret values."""
    if not path.exists():
        return {}

    try:
        config = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"Could not read deployment config '{path}': {exc}") from exc

    if not isinstance(config, dict):
        raise RuntimeError(f"Deployment config '{path}' must contain a JSON object")
    return config


def setting(config: dict[str, Any], env_name: str, config_name: str, default: str = "") -> str:
    """Return an environment override, JSON value, or default as a string."""
    value = os.environ.get(env_name, config.get(config_name, default))
    return str(value).strip() if value is not None else ""


def required_setting(config: dict[str, Any], env_name: str, config_name: str) -> str:
    value = setting(config, env_name, config_name)
    if not value:
        raise RuntimeError(
            f"Missing deployment setting: set {env_name} or '{config_name}' in {CONFIG_PATH}"
        )
    return value


def build_zip(build_path: Path) -> bytes:
    """Zip the contents of build_path into an in-memory archive."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for file in sorted(build_path.rglob("*")):
            if file.is_dir():
                continue
            rel = file.relative_to(build_path)
            if any(part in (".git", "node_modules", "__pycache__") for part in rel.parts):
                continue
            zf.write(file, str(rel))
            print(f"  + {rel}")
    return buf.getvalue()


def deploy_bundle(
    build_path: Path,
    base_url: str,
    project_name: str,
    target_folder: str,
    deploy_token: str,
) -> bool:
    """Zip the build and upload it as a single authenticated bundle."""
    url = f"{base_url.rstrip('/')}/api/deploy/{project_name}/bundle"
    headers = {"X-Deploy-Token": deploy_token}

    print("Building zip archive...")
    zip_bytes = build_zip(build_path)
    print(f"Archive size: {len(zip_bytes) / 1024:.1f} KB\n")

    print("Uploading bundle...")
    try:
        response = requests.post(
            url,
            files={"bundle": ("build.zip", zip_bytes, "application/zip")},
            data={"target_folder": target_folder},
            headers=headers,
            timeout=300,
        )
    except requests.RequestException as exc:
        print(f"  Upload exception: {exc}")
        return False

    if response.status_code == 200:
        data = response.json()
        print(f"  {data.get('uploaded', 0)} files uploaded")
        if data.get("failed"):
            print("  Failures:")
            for failure in data["failed"]:
                print(f"    {failure['path']}: {failure['error']}")
        return not data.get("failed")

    print(f"  Upload failed with HTTP {response.status_code}: {response.text[:400]}")
    return False


def main() -> None:
    try:
        config = load_config()
        base_url = required_setting(config, "DEPLOY_BASE_URL", "base_url")
        deploy_token = required_setting(config, "DEPLOY_TOKEN", "token")
        project_name = setting(config, "DEPLOY_PROJECT_NAME", "project_name", "weather-clock")
        build_dir = setting(config, "DEPLOY_BUILD_DIR", "build_dir", "dist")
        target_folder = setting(config, "DEPLOY_FOLDER", "target_folder", project_name)
    except RuntimeError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(2)

    build_path = Path(build_dir)
    if not build_path.is_dir():
        print(f"ERROR: Build directory '{build_dir}/' does not exist.", file=sys.stderr)
        print("Run the production build before deploying.", file=sys.stderr)
        sys.exit(1)

    print(f"\n=== Deploying '{project_name}' ===\n")
    success = deploy_bundle(build_path, base_url, project_name, target_folder, deploy_token)
    print(f"\n=== {'Deployment complete' if success else 'Deployment finished with errors'} ===")
    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()
