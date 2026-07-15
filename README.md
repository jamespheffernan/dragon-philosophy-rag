# Dragon

Dragon is a full-stack retrieval-augmented generation prototype for exploring philosophical texts. It ingests PDF, EPUB, and text files, builds a searchable vector index, and supports semantic search, cited question answering, situation analysis, author-specific voice guides, and saved conversations.

This repository is a privacy-safe public source snapshot. It does not contain the private repository's Git history, API credential, deployment configuration, live service URLs, uploaded books, vector database, conversation database, or internal delivery notes. It is not the deployment source for the existing hosted prototype.

## Architecture

- **API:** Python 3.11+, FastAPI, LangChain, and a small SQLite vector store
- **Interface:** Next.js 16, React 19, and TypeScript
- **AI:** OpenAI text embeddings and `gpt-5-mini` through LangChain
- **Storage:** local files and SQLite by default

## What it does

- imports individual or merged PDF, EPUB, and plain-text documents;
- stores document metadata and validates the vector index on startup;
- searches passages semantically and returns source context;
- answers questions or analyzes situations against the imported corpus;
- creates optional author voice guides from source passages;
- saves conversations and supports document re-indexing.

## Run locally

### Backend

```bash
cd backend
python3.11 -m venv .venv
source .venv/bin/activate
pip install -r requirements.lock
cp .env.example .env
# Replace the placeholder OPENAI_API_KEY in .env.
uvicorn main:app --reload
```

The API starts at `http://localhost:8000`. Its health endpoint is `/health`.

### Frontend

In a second terminal:

```bash
cd frontend
npm ci
cp .env.example .env.local
npm run dev
```

The interface starts at `http://localhost:3000` and uses the local API by default.

## Test and build

```bash
cd backend
pytest

cd ../frontend
npm run lint
npm run build
npm audit --audit-level=high
```

## Privacy and security boundary

Dragon is a single-user prototype, not a hardened multi-tenant service. It has no application authentication or authorization layer. Run it on a trusted machine or add access control before exposing it to a network.

Uploaded source files, document metadata, vector data, and conversations are stored locally by default and are ignored by Git. Text is sent to OpenAI for embeddings, answers, analysis, and voice-guide generation. Only import material you are permitted to process, and review OpenAI's data terms for your account before using private or copyrighted documents.

The private prototype originally used ChromaDB. This public snapshot replaces it with an embedded SQLite vector table because the current ChromaDB release has an unfixed remote-code-execution advisory in its server API. Dragon never exposed that server API, but removing the dependency produces a smaller and auditable local boundary.

Keep `OPENAI_API_KEY` in `backend/.env` or a secret manager. Never put a real key in documentation, source files, screenshots, or Git history.

## Public extraction boundary

The public snapshot was assembled from an explicit source allowlist and starts with a new Git root. It intentionally excludes the private repository's instructions, project notes, deployment files, historical pull-request refs, and all private history. The original repository remains private because its history contains a revoked-or-to-be-revoked OpenAI key and may still be connected to the hosted prototype.

No open-source license has been selected for this snapshot. Public visibility permits inspection but does not grant reuse rights.
