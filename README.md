# TikaToKa

Web PvP dice board MVP.

## Local

```bash
npm install
npm run dev
```

Open `http://localhost:5173`.

## Deploy

This app needs a long-running Node server because rooms and SSE updates are held in memory.

### Render

1. Push this project to GitHub.
2. In Render, create a new Blueprint from the repository.
3. Render will use `render.yaml`.

### Generic Node host

Use:

```bash
npm install
npm start
```

The server reads `PORT` from the host. Health check path: `/healthz`.

### Docker

```bash
docker build -t tikatoka .
docker run --rm -p 5173:5173 tikatoka
```
