import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { randomUUID } from "node:crypto";
import {
  autoPlaceDice,
  createGame,
  finishByLeave,
  getEmptyCells,
  rerollDice,
  selectDice,
  TURN_LIMIT_SECONDS,
  placeDice
} from "./src/gameEngine.js";

const PORT = Number(process.env.PORT || 5173);
const PUBLIC_DIR = join(process.cwd(), "public");
const rooms = new Map();
const streams = new Map();

const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if ((req.method === "GET" || req.method === "HEAD") && url.pathname === "/healthz") {
      return sendJson(res, 200, { ok: true });
    }
    if (req.method === "GET" && url.pathname === "/api/events") return handleEvents(req, res, url);
    if (req.method === "POST" && url.pathname.startsWith("/api/")) return handleApi(req, res, url.pathname);
    if (req.method === "GET") return serveStatic(res, url.pathname);
    sendJson(res, 405, { error: "Method not allowed" });
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
});

server.listen(PORT, () => {
  console.log(`TikaToKa local server: http://localhost:${PORT}`);
});

setInterval(() => {
  for (const room of rooms.values()) {
    if (room.status !== "PLAYING" || !room.game) continue;
    const elapsed = Date.now() - room.game.turnStartedAt;
    if (elapsed >= TURN_LIMIT_SECONDS * 1000) {
      try {
        autoPlaceDice(room.game);
        broadcast(room);
      } catch (error) {
        room.game.events = [error.message];
        broadcast(room);
      }
    } else {
      broadcast(room, "tick");
    }
  }
}, 1000);

async function handleApi(req, res, path) {
  const body = await readBody(req);
  if (path === "/api/create-room") return createRoom(res, body);
  if (path === "/api/join-room") return joinRoom(res, body);
  if (path === "/api/place-dice") return placeDiceRoute(res, body);
  if (path === "/api/reroll-dice") return rerollDiceRoute(res, body);
  if (path === "/api/select-dice") return selectDiceRoute(res, body);
  if (path === "/api/rematch") return rematchRoute(res, body);
  if (path === "/api/leave-room") return leaveRoomRoute(res, body);
  sendJson(res, 404, { error: "Not found" });
}

function createRoom(res, body) {
  const nickname = sanitizeNickname(body.nickname);
  if (!nickname) return sendJson(res, 400, { error: "닉네임을 입력하세요." });

  const roomCode = createRoomCode();
  const playerId = randomUUID();
  const room = {
    roomCode,
    status: "WAITING",
    players: [{ id: playerId, nickname, slot: 1 }],
    game: null
  };
  rooms.set(roomCode, room);
  sendJson(res, 200, { roomCode, playerId, state: serializeRoom(room, playerId) });
}

function joinRoom(res, body) {
  const nickname = sanitizeNickname(body.nickname);
  const roomCode = String(body.roomCode || "").trim().toUpperCase();
  if (!nickname) return sendJson(res, 400, { error: "닉네임을 입력하세요." });
  const room = rooms.get(roomCode);
  if (!room) return sendJson(res, 404, { error: "존재하지 않는 방입니다." });
  if (room.status !== "WAITING") return sendJson(res, 409, { error: "이미 게임이 시작된 방입니다." });
  if (room.players.length >= 2) return sendJson(res, 409, { error: "방 인원이 가득 찼습니다." });

  const playerId = randomUUID();
  room.players.push({ id: playerId, nickname, slot: 2 });
  startGame(room);
  broadcast(room);
  sendJson(res, 200, { roomCode, playerId, state: serializeRoom(room, playerId) });
}

function placeDiceRoute(res, body) {
  const room = rooms.get(String(body.roomCode || "").toUpperCase());
  if (!room || !room.game) return sendJson(res, 404, { error: "존재하지 않는 방입니다." });
  try {
    placeDice(room.game, body.playerId, Number(body.row), { targetPlayerId: body.targetPlayerId });
    broadcast(room);
    sendJson(res, 200, { state: serializeRoom(room, body.playerId) });
  } catch (error) {
    sendJson(res, 400, { error: error.message });
  }
}

function rerollDiceRoute(res, body) {
  const room = rooms.get(String(body.roomCode || "").toUpperCase());
  if (!room || !room.game) return sendJson(res, 404, { error: "존재하지 않는 방입니다." });
  try {
    rerollDice(room.game, body.playerId);
    broadcast(room);
    sendJson(res, 200, { state: serializeRoom(room, body.playerId) });
  } catch (error) {
    sendJson(res, 400, { error: error.message });
  }
}

function selectDiceRoute(res, body) {
  const room = rooms.get(String(body.roomCode || "").toUpperCase());
  if (!room || !room.game) return sendJson(res, 404, { error: "존재하지 않는 방입니다." });
  try {
    selectDice(room.game, body.playerId, Number(body.value));
    broadcast(room);
    sendJson(res, 200, { state: serializeRoom(room, body.playerId) });
  } catch (error) {
    sendJson(res, 400, { error: error.message });
  }
}

function rematchRoute(res, body) {
  const room = rooms.get(String(body.roomCode || "").toUpperCase());
  if (!room) return sendJson(res, 404, { error: "존재하지 않는 방입니다." });
  if (room.players.length < 2) return sendJson(res, 409, { error: "상대방을 기다리는 중입니다." });
  startGame(room);
  broadcast(room);
  sendJson(res, 200, { state: serializeRoom(room, body.playerId) });
}

function leaveRoomRoute(res, body) {
  const room = rooms.get(String(body.roomCode || "").toUpperCase());
  if (!room) return sendJson(res, 200, { ok: true });

  const leavingId = body.playerId;
  const remaining = room.players.find((player) => player.id !== leavingId);
  if (room.status === "PLAYING" && remaining && room.game) {
    finishByLeave(room.game, remaining.id);
    room.status = "FINISHED";
    broadcast(room);
  } else {
    rooms.delete(room.roomCode);
  }
  sendJson(res, 200, { ok: true });
}

function startGame(room) {
  room.status = "PLAYING";
  room.game = createGame(room.players.map((player) => player.id));
}

function handleEvents(req, res, url) {
  const roomCode = String(url.searchParams.get("roomCode") || "").toUpperCase();
  const playerId = url.searchParams.get("playerId");
  const room = rooms.get(roomCode);
  if (!room || !playerId) {
    res.writeHead(404);
    res.end();
    return;
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive"
  });
  res.write("\n");

  const key = `${roomCode}:${playerId}:${randomUUID()}`;
  streams.set(key, { res, roomCode, playerId });
  sendEvent(res, "state", serializeRoom(room, playerId));
  req.on("close", () => streams.delete(key));
}

function broadcast(room, event = "state") {
  for (const stream of streams.values()) {
    if (stream.roomCode === room.roomCode) {
      sendEvent(stream.res, event, serializeRoom(room, stream.playerId));
    }
  }
}

function sendEvent(res, event, payload) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function serializeRoom(room, viewerId) {
  const game = room.game;
  const opponent = room.players.find((player) => player.id !== viewerId) || null;
  const viewer = room.players.find((player) => player.id === viewerId) || null;
  const secondsLeft = game
    ? Math.max(0, TURN_LIMIT_SECONDS - Math.floor((Date.now() - game.turnStartedAt) / 1000))
    : TURN_LIMIT_SECONDS;

  return {
    roomCode: room.roomCode,
    status: room.status,
    playerId: viewerId,
    viewer,
    opponent,
    players: room.players,
    game: game
      ? {
          status: game.status,
          currentTurnPlayerId: game.currentTurnPlayerId,
          currentDiceValue: game.currentDiceValue,
          currentDiceProtected: game.currentDiceProtected,
          diceOptions: game.diceOptions,
          bonusPlacement: game.bonusPlacement,
          rerollsUsed: game.rerollsUsed,
          turnLimitSeconds: game.turnLimitSeconds,
          boards: game.boards,
          scores: game.scores,
          secondsLeft,
          winnerId: game.winnerId,
          finishedReason: game.finishedReason,
          events: game.events,
          emptyCells: Object.fromEntries(
            game.playerOrder.map((id) => [id, getEmptyCells(game.boards[id]).length])
          )
        }
      : null
  };
}

async function serveStatic(res, pathname) {
  const requested = pathname === "/" ? "/index.html" : pathname;
  const safePath = normalize(requested).replace(/^(\.\.[/\\])+/, "");
  const filePath = join(PUBLIC_DIR, safePath);
  if (!filePath.startsWith(PUBLIC_DIR)) return sendJson(res, 403, { error: "Forbidden" });

  try {
    const content = await readFile(filePath);
    res.writeHead(200, { "Content-Type": mime[extname(filePath)] || "application/octet-stream" });
    res.end(content);
  } catch {
    sendJson(res, 404, { error: "Not found" });
  }
}

function createRoomCode() {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let code = "";
  do {
    code = Array.from({ length: 6 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
  } while (rooms.has(code));
  return code;
}

function sanitizeNickname(value) {
  return String(value || "").trim().slice(0, 16);
}

async function readBody(req) {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  return raw ? JSON.parse(raw) : {};
}

function sendJson(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}
