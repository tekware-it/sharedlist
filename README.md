# SharedList

SharedList is a friendly little app for shared lists that keeps things simple
and private. Your data is encrypted on the client before it ever leaves your
phone, so the backend only sees ciphertext and technical metadata.

SharedList is free, with no ads. If you like it, donations help cover backend
hosting and Apple/Android store costs.

[![Support development - Buy me a coffee](https://img.shields.io/badge/Support%20development-Buy%20me%20a%20coffee-orange)](https://buymeacoffee.com/sharedlist)

## What it does

- Create shared lists and sync them across devices.
- Work offline and reconcile changes when back online.
- Share lists via links.
- Protect data with client-side end-to-end encryption.

## How it works (short)

- React Native app (iOS/Android) handles UI and local encryption.
- FastAPI backend exposes REST APIs and stores only encrypted data.
- PostgreSQL for persistence and Redis for rate limiting.
- Incremental sync via item revisions.

## Project structure

- `frontend/sharedlistapp`: React Native app.
- `backend`: FastAPI API + Postgres + Redis.

## Quick start

### Frontend (React Native)

```bash
cd frontend/sharedlistapp
npm install
npm start
```

In another terminal:

```bash
# Android
npm run android

# iOS (macOS)
bundle install
bundle exec pod install
npm run ios
```

Note: in Android Studio, open `frontend/sharedlistapp/android`.

### Backend (FastAPI)

```bash
cd backend
docker-compose up --build
```

The backend will be available at `http://localhost:8000`.

## Configuration

- Default backend URL: `https://api.sharedlist.ovh` (configurable in the app
  settings).
- Database schema: `backend/schema.sql`.

## Main API endpoints

- `POST /v1/lists` - create list (encrypted metadata)
- `GET /v1/lists/{list_id}` - fetch metadata
- `DELETE /v1/lists/{list_id}` - delete list
- `POST /v1/lists/{list_id}/items` - create item
- `GET /v1/lists/{list_id}/items?since_rev=` - incremental fetch
- `PUT /v1/lists/{list_id}/items/{item_id}` - update item
- `DELETE /v1/lists/{list_id}/items/{item_id}` - delete item

See `backend/README.md` and `backend/tests/test_api.py` for more details.

## Versioning and releases

Use the helper script to sync versions across the app, update the changelog,
create a commit, and tag the release:

```bash
python3 scripts/bump_version.py --version 1.2.3
```

Optional flags:

- `--no-changelog` to skip `CHANGELOG.md`
- `--no-commit` to skip the version bump commit
- `--no-tag` to skip creating `vX.Y.Z`
- `--build 42` to set the iOS build number explicitly
- `--code 10203` to set the Android `versionCode` explicitly

Changelog entries are generated from commits that follow these prefixes:
`feat`, `fix`, `perf`, `refactor`, `chore`, `docs`, `test`, `build`, `ci`.
The script creates an annotated git tag (`git tag -a`) using the same release
notes that go into `CHANGELOG.md`.
