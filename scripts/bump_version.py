#!/usr/bin/env python3
import argparse
import json
import re
import subprocess
from datetime import date
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
ALLOWED_PREFIXES = (
    "feat",
    "fix",
    "perf",
    "refactor",
    "chore",
    "docs",
    "test",
    "build",
    "ci",
)


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def write_text(path: Path, text: str) -> None:
    path.write_text(text, encoding="utf-8")


def compute_version_code(version: str) -> int:
    parts = version.split(".")
    if len(parts) != 3:
        raise ValueError("Version must be in MAJOR.MINOR.PATCH format.")
    major, minor, patch = (int(p) for p in parts)
    return major * 10000 + minor * 100 + patch


def update_package_json(path: Path, version: str) -> None:
    text = read_text(path)
    updated = re.sub(r'"version"\s*:\s*"[^"]+"', f'"version": "{version}"', text)
    if updated == text:
        raise RuntimeError(f"Failed to update version in {path}.")
    write_text(path, updated)


def update_android_build_gradle(path: Path, version: str, version_code: int) -> None:
    text = read_text(path)
    updated = re.sub(r'(versionName\s+")[^"]*(")', rf'\g<1>{version}\2', text)
    updated = re.sub(r"(versionCode\s+)\d+", rf"\g<1>{version_code}", updated)
    if updated == text:
        raise RuntimeError(f"Failed to update versionName/versionCode in {path}.")
    write_text(path, updated)


def update_ios_pbxproj(path: Path, version: str, build: int) -> None:
    text = read_text(path)
    updated = re.sub(
        r"(MARKETING_VERSION\s*=\s*)([^;]+);",
        rf"\g<1>{version};",
        text,
    )
    updated = re.sub(
        r"(CURRENT_PROJECT_VERSION\s*=\s*)(\d+);",
        rf"\g<1>{build};",
        updated,
    )
    if updated == text:
        raise RuntimeError(f"Failed to update MARKETING_VERSION/CURRENT_PROJECT_VERSION in {path}.")
    write_text(path, updated)


def read_current_build(path: Path) -> int:
    text = read_text(path)
    match = re.search(r"CURRENT_PROJECT_VERSION\s*=\s*(\d+);", text)
    if not match:
        raise RuntimeError(f"Could not find CURRENT_PROJECT_VERSION in {path}.")
    return int(match.group(1))


def run(cmd: list[str]) -> str:
    result = subprocess.run(
        cmd,
        cwd=ROOT,
        check=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    return result.stdout.strip()


def get_last_tag() -> str | None:
    try:
        return run(["git", "describe", "--tags", "--abbrev=0"])
    except subprocess.CalledProcessError:
        return None


def filter_commit_lines(lines: list[str]) -> list[str]:
    pattern = re.compile(
        r"^(?:"
        + "|".join(re.escape(prefix) for prefix in ALLOWED_PREFIXES)
        + r")(?:\([^)]+\))?:\s+.+"
    )
    return [line for line in lines if pattern.match(line)]


def build_changelog(version: str) -> tuple[str, str]:
    last_tag = get_last_tag()
    if last_tag:
        log_range = f"{last_tag}..HEAD"
        raw = run(["git", "log", log_range, "--pretty=format:%s (%h)"])
    else:
        raw = run(["git", "log", "--pretty=format:%s (%h)"])

    filtered = filter_commit_lines([line for line in raw.splitlines() if line.strip()])
    entries = [f"- {line}" for line in filtered]
    if not entries:
        entries = ["- (no user-facing changes)"]

    heading = f"## v{version} - {date.today().isoformat()}"
    changelog = "\n".join([heading, ""] + entries + [""])
    release_notes = "\n".join([f"Release v{version}", ""] + entries + [""])
    return changelog, release_notes


def update_changelog(path: Path, content: str) -> None:
    if path.exists():
        existing = read_text(path).rstrip()
        updated = "\n\n".join([content.rstrip(), existing]) + "\n"
    else:
        updated = content.rstrip() + "\n"
    write_text(path, updated)


def read_existing_changelog(path: Path) -> str:
    if not path.exists():
        raise RuntimeError(f"{path} not found. Create it before using --use-existing-changelog.")
    text = read_text(path).strip()
    if not text:
        raise RuntimeError(f"{path} is empty. Add release notes before using --use-existing-changelog.")

    match = re.search(r"^##\s+.+$", text, flags=re.MULTILINE)
    if not match:
        raise RuntimeError(f"{path} must start with a '##' heading for release notes.")

    start = match.start()
    next_heading = re.search(r"^##\s+.+$", text[match.end():], flags=re.MULTILINE)
    end = match.end() + (next_heading.start() if next_heading else len(text) - match.end())
    return text[start:end].rstrip() + "\n"


def create_git_tag(version: str, release_notes: str) -> None:
    tag_name = f"v{version}"
    run(["git", "tag", "-a", tag_name, "-m", release_notes])


def create_git_commit(version: str) -> None:
    run(["git", "add", "frontend/sharedlistapp/package.json"])
    run(["git", "add", "frontend/sharedlistapp/android/app/build.gradle"])
    run(["git", "add", "frontend/sharedlistapp/ios/sharedlistapp.xcodeproj/project.pbxproj"])
    if (ROOT / "CHANGELOG.md").exists():
        run(["git", "add", "CHANGELOG.md"])
    run(["git", "commit", "-m", f"Bump version to {version}"])


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Sync app versions across package.json, Android, and iOS."
    )
    parser.add_argument("--version", required=True, help="SemVer like 1.2.3")
    parser.add_argument(
        "--build",
        type=int,
        help="iOS build number (defaults to current + 1)",
    )
    parser.add_argument(
        "--code",
        type=int,
        help="Android versionCode (defaults to SemVer -> MAJOR*10000 + MINOR*100 + PATCH)",
    )
    parser.add_argument(
        "--no-tag",
        action="store_true",
        help="Skip creating a git tag (vX.Y.Z).",
    )
    parser.add_argument(
        "--no-changelog",
        action="store_true",
        help="Skip updating CHANGELOG.md.",
    )
    parser.add_argument(
        "--use-existing-changelog",
        action="store_true",
        help="Use existing CHANGELOG.md for release notes without updating it.",
    )
    parser.add_argument(
        "--no-commit",
        action="store_true",
        help="Skip creating a git commit.",
    )
    args = parser.parse_args()

    version = args.version.strip()
    version_code = args.code or compute_version_code(version)

    package_json = ROOT / "frontend" / "sharedlistapp" / "package.json"
    gradle = ROOT / "frontend" / "sharedlistapp" / "android" / "app" / "build.gradle"
    pbxproj = (
        ROOT
        / "frontend"
        / "sharedlistapp"
        / "ios"
        / "sharedlistapp.xcodeproj"
        / "project.pbxproj"
    )

    build_number = args.build
    if build_number is None:
        build_number = read_current_build(pbxproj) + 1

    update_package_json(package_json, version)
    update_android_build_gradle(gradle, version, version_code)
    update_ios_pbxproj(pbxproj, version, build_number)

    release_notes = ""
    changelog = ROOT / "CHANGELOG.md"
    if args.use_existing_changelog:
        release_notes = read_existing_changelog(changelog)
    elif not args.no_changelog:
        changelog_text, release_notes = build_changelog(version)
        update_changelog(changelog, changelog_text)

    if not args.no_commit:
        create_git_commit(version)

    if not args.no_tag:
        if not release_notes:
            _, release_notes = build_changelog(version)
        create_git_tag(version, release_notes)

    print(f"Updated version: {version}")
    print(f"Android versionCode: {version_code}")
    print(f"iOS build number: {build_number}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
