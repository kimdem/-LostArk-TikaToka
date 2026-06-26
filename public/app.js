const state = {
  roomCode: localStorage.getItem("tikatoka.roomCode") || "",
  playerId: localStorage.getItem("tikatoka.playerId") || "",
  eventSource: null,
  snapshot: null,
  audioContext: null,
  audioUnlocked: false,
  lastEventSignature: ""
};

const $ = (id) => document.getElementById(id);

const els = {
  startView: $("startView"),
  roomView: $("roomView"),
  gameView: $("gameView"),
  nicknameInput: $("nicknameInput"),
  roomCodeInput: $("roomCodeInput"),
  startError: $("startError"),
  createRoomButton: $("createRoomButton"),
  joinRoomButton: $("joinRoomButton"),
  roomCodeText: $("roomCodeText"),
  gameRoomCode: $("gameRoomCode"),
  copyButton: $("copyButton"),
  leaveRoomButton: $("leaveRoomButton"),
  playerList: $("playerList"),
  waitingPanel: $("waitingPanel"),
  turnLabel: $("turnLabel"),
  timerText: $("timerText"),
  timerBarFill: $("timerBarFill"),
  timerBarText: $("timerBarText"),
  opponentName: $("opponentName"),
  opponentScore: $("opponentScore"),
  opponentBoard: $("opponentBoard"),
  opponentLineScores: $("opponentLineScores"),
  currentDice: $("currentDice"),
  diceOptions: $("diceOptions"),
  rerollButton: $("rerollButton"),
  eventLog: $("eventLog"),
  myBoard: $("myBoard"),
  myLineScores: $("myLineScores"),
  myName: $("myName"),
  myScore: $("myScore"),
  resultModal: $("resultModal"),
  resultTitle: $("resultTitle"),
  resultScore: $("resultScore"),
  rematchButton: $("rematchButton"),
  modalLeaveButton: $("modalLeaveButton")
};

els.createRoomButton.addEventListener("click", async () => {
  await callRoomApi("/api/create-room", { nickname: els.nicknameInput.value });
});

els.joinRoomButton.addEventListener("click", async () => {
  await callRoomApi("/api/join-room", {
    nickname: els.nicknameInput.value,
    roomCode: els.roomCodeInput.value
  });
});

els.copyButton.addEventListener("click", async () => {
  await navigator.clipboard.writeText(state.roomCode);
  els.copyButton.textContent = "복사됨";
  setTimeout(() => {
    els.copyButton.textContent = "복사";
  }, 1000);
});

els.leaveRoomButton.addEventListener("click", leaveRoom);
els.modalLeaveButton.addEventListener("click", leaveRoom);
els.rematchButton.addEventListener("click", async () => {
  await api("/api/rematch", { roomCode: state.roomCode, playerId: state.playerId });
});
els.rerollButton.addEventListener("click", async () => {
  await api("/api/reroll-dice", { roomCode: state.roomCode, playerId: state.playerId }).catch((error) =>
    setError(error.message)
  );
});

document.addEventListener(
  "pointerdown",
  () => {
    unlockAudio();
  },
  { once: true }
);

window.addEventListener("beforeunload", () => {
  if (state.roomCode && state.playerId) {
    navigator.sendBeacon(
      "/api/leave-room",
      new Blob([JSON.stringify({ roomCode: state.roomCode, playerId: state.playerId })], {
        type: "application/json"
      })
    );
  }
});

async function callRoomApi(path, payload) {
  setError("");
  try {
    const result = await api(path, payload);
    setSession(result.roomCode, result.playerId);
    connectEvents();
    render(result.state);
  } catch (error) {
    setError(error.message);
  }
}

async function api(path, payload) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "요청에 실패했습니다.");
  return data;
}

function setSession(roomCode, playerId) {
  state.roomCode = roomCode;
  state.playerId = playerId;
  localStorage.setItem("tikatoka.roomCode", roomCode);
  localStorage.setItem("tikatoka.playerId", playerId);
}

function connectEvents() {
  if (state.eventSource) state.eventSource.close();
  state.eventSource = new EventSource(`/api/events?roomCode=${state.roomCode}&playerId=${state.playerId}`);
  state.eventSource.addEventListener("state", (event) => render(JSON.parse(event.data)));
  state.eventSource.addEventListener("tick", (event) => render(JSON.parse(event.data)));
  state.eventSource.onerror = () => {};
}

function render(snapshot) {
  state.snapshot = snapshot;
  els.roomCodeText.textContent = snapshot.roomCode;
  els.gameRoomCode.textContent = snapshot.roomCode;

  if (snapshot.status === "WAITING") {
    show("room");
    renderWaiting(snapshot);
    return;
  }

  show("game");
  renderGame(snapshot);
}

function show(view) {
  els.startView.classList.toggle("hidden", view !== "start");
  els.roomView.classList.toggle("hidden", view !== "room");
  els.gameView.classList.toggle("hidden", view !== "game");
}

function renderWaiting(snapshot) {
  els.playerList.innerHTML = "";
  for (let slot = 1; slot <= 2; slot += 1) {
    const player = snapshot.players.find((item) => item.slot === slot);
    const row = document.createElement("div");
    row.className = "player-row";
    row.innerHTML = `<strong>플레이어 ${slot}: ${escapeHtml(player?.nickname || "참가 대기 중")}</strong><span>${player ? "준비 완료" : "대기"}</span>`;
    els.playerList.append(row);
  }
}

function renderGame(snapshot) {
  const { game, viewer, opponent } = snapshot;
  const myId = snapshot.playerId;
  const opponentId = opponent?.id;
  const myScore = game.scores[myId]?.totalScore || 0;
  const opponentTotal = opponentId ? game.scores[opponentId]?.totalScore || 0 : 0;
  const isMyTurn = game.currentTurnPlayerId === myId && game.status === "PLAYING";
  const isBonus = Boolean(game.bonusPlacement);
  const mustSelectDice = Boolean(game.diceOptions);

  els.resultModal.classList.toggle("hidden", game.status !== "FINISHED");
  els.myName.textContent = `${viewer?.nickname || "나"} (${game.emptyCells[myId]}칸 남음)`;
  els.opponentName.textContent = `${opponent?.nickname || "상대"} (${opponentId ? game.emptyCells[opponentId] : 9}칸 남음)`;
  els.myScore.textContent = `${myScore}점`;
  els.opponentScore.textContent = `${opponentTotal}점`;
  els.turnLabel.textContent = game.status === "FINISHED" ? "종료" : isMyTurn ? (isBonus ? "알까기" : "내 턴") : "상대 턴";
  els.timerText.textContent = game.secondsLeft;
  renderTimerBar(game.secondsLeft, game.turnLimitSeconds || 15);
  renderDiceFace(els.currentDice, game.status === "PLAYING" ? game.currentDiceValue : null, { placeholder: "-" });
  els.currentDice.classList.toggle("protected", Boolean(game.currentDiceProtected));
  els.rerollButton.disabled = !isMyTurn || mustSelectDice || game.rerollsUsed?.[myId] || game.status !== "PLAYING";
  renderDiceOptions(game.diceOptions || []);

  renderBoard(els.myBoard, game.boards[myId], {
    canPlace: isMyTurn && !mustSelectDice,
    active: isMyTurn && !mustSelectDice,
    activeKind: "mine",
    mirror: false,
    targetPlayerId: myId,
    onPlace: placeDice
  });
  renderBoard(els.opponentBoard, opponentId ? game.boards[opponentId] : emptyBoard(), {
    canPlace: isMyTurn && isBonus && !mustSelectDice,
    active: !isMyTurn && game.status === "PLAYING",
    activeKind: "opponent",
    mirror: true,
    targetPlayerId: opponentId,
    onPlace: placeDice
  });
  const myLineScores = game.scores[myId]?.lineScores || [0, 0, 0];
  const opponentLineScores = opponentId ? game.scores[opponentId]?.lineScores || [0, 0, 0] : [0, 0, 0];
  const opponentBoard = opponentId ? game.boards[opponentId] : emptyBoard();
  renderLineScores(els.myLineScores, myLineScores, {
    side: "mine",
    otherScores: opponentLineScores,
    board: game.boards[myId],
    otherBoard: opponentBoard
  });
  renderLineScores(els.opponentLineScores, opponentLineScores, {
    side: "opponent",
    otherScores: myLineScores,
    board: opponentBoard,
    otherBoard: game.boards[myId]
  });
  playEventSound(game.events || []);
  renderEvents(game.events || []);
  renderResult(snapshot);
}

function renderBoard(container, board, options = {}) {
  const { canPlace = false, active = false, activeKind = "mine", mirror = false, targetPlayerId, onPlace } = options;
  container.classList.toggle("active-mine", active && activeKind === "mine");
  container.classList.toggle("active-opponent", active && activeKind === "opponent");
  container.innerHTML = "";
  board.forEach((row, rowIndex) => {
    const displayRow = mirror ? [...row].reverse() : row;
    displayRow.forEach((cell, colIndex) => {
      const value = cellValue(cell);
      const previous = cellValue(displayRow[colIndex - 1]);
      const next = cellValue(displayRow[colIndex + 1]);
      const button = document.createElement("button");
      button.type = "button";
      button.className = [
        "cell",
        value == null ? "" : "filled",
        cell?.protected ? "protected" : "",
        value != null && previous === value ? "linked-left" : "",
        value != null && next === value ? "linked-right" : "",
        canPlace && value == null && row.some((cell) => cell == null) ? "can-place" : ""
      ]
        .filter(Boolean)
        .join(" ");
      renderDiceFace(button, value);
      button.disabled = !canPlace || value != null || !row.some((cell) => cell == null);
      button.addEventListener("click", () => onPlace?.(rowIndex, targetPlayerId));
      container.append(button);
    });
  });
}

async function placeDice(row, targetPlayerId) {
  try {
    await api("/api/place-dice", {
      roomCode: state.roomCode,
      playerId: state.playerId,
      row,
      targetPlayerId
    });
  } catch (error) {
    setError(error.message);
  }
}

function renderDiceOptions(options) {
  els.diceOptions.innerHTML = "";
  options.forEach((value) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "dice-choice";
    renderDiceFace(button, value);
    button.addEventListener("click", async () => {
      await api("/api/select-dice", { roomCode: state.roomCode, playerId: state.playerId, value }).catch((error) =>
        setError(error.message)
      );
    });
    els.diceOptions.append(button);
  });
}

function renderLineScores(container, scores, options = {}) {
  const { side = "mine", otherScores = [], board = emptyBoard(), otherBoard = emptyBoard() } = options;
  container.innerHTML = "";
  scores.forEach((score, index) => {
    const minePerspectiveScore = side === "mine" ? score : otherScores[index] || 0;
    const opponentPerspectiveScore = side === "mine" ? otherScores[index] || 0 : score;
    const isMineWinning = minePerspectiveScore > opponentPerspectiveScore;
    const isOpponentWinning = opponentPerspectiveScore > minePerspectiveScore;
    const isThisBoxWinning = side === "mine" ? isMineWinning : isOpponentWinning;
    const bothFull = isLineFull(board[index]) && isLineFull(otherBoard[index]);
    const item = document.createElement("div");
    item.className = [
      "line-score",
      side === "mine" && isThisBoxWinning ? "score-mine-winning" : "",
      side === "opponent" && isThisBoxWinning ? "score-opponent-winning" : "",
      bothFull && isThisBoxWinning ? "score-locked-winner" : ""
    ]
      .filter(Boolean)
      .join(" ");
    item.textContent = score;
    container.append(item);
  });
}

function renderTimerBar(secondsLeft, limitSeconds) {
  const safeLimit = Math.max(1, limitSeconds);
  const safeSeconds = Math.max(0, secondsLeft);
  const percent = Math.max(0, Math.min(100, (safeSeconds / safeLimit) * 100));
  els.timerBarFill.style.width = `${percent}%`;
  els.timerBarText.textContent = `${safeSeconds}초`;
}

function renderDiceFace(container, value, options = {}) {
  container.innerHTML = "";
  if (value == null) {
    container.textContent = options.placeholder || "";
    return;
  }
  const face = document.createElement("span");
  face.className = `dice-face value-${value}`;
  for (let index = 0; index < value; index += 1) {
    const pip = document.createElement("span");
    pip.className = "pip";
    face.append(pip);
  }
  container.append(face);
}

function renderEvents(events) {
  els.eventLog.innerHTML = "";
  events.slice(-3).forEach((message) => {
    const li = document.createElement("li");
    li.textContent = message;
    els.eventLog.append(li);
  });
}

function playEventSound(events) {
  const signature = events.join("|");
  if (!signature || signature === state.lastEventSignature) return;
  state.lastEventSignature = signature;

  const joined = events.join(" ");
  if (joined.includes("알까기") || joined.includes("쳐냈")) {
    playSound("hit");
  } else if (joined.includes("선택할 수 있습니다")) {
    playSound("reroll");
  } else if (joined.includes("배치했습니다")) {
    playSound("place");
  }
}

function unlockAudio() {
  if (!state.audioContext) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    state.audioContext = new AudioContextClass();
  }
  state.audioContext.resume();
  state.audioUnlocked = true;
}

function playSound(type) {
  if (!state.audioUnlocked) return;
  const context = state.audioContext;
  const now = context.currentTime;

  if (type === "place") {
    playTone(context, 220, now, 0.08, 0.08);
    playTone(context, 150, now + 0.04, 0.08, 0.05);
  } else if (type === "reroll") {
    playTone(context, 420, now, 0.05, 0.05);
    playTone(context, 520, now + 0.05, 0.06, 0.05);
    playTone(context, 640, now + 0.1, 0.07, 0.045);
  } else if (type === "hit") {
    playTone(context, 110, now, 0.14, 0.12, "sawtooth");
    playTone(context, 70, now + 0.04, 0.16, 0.09, "square");
  }
}

function playTone(context, frequency, start, duration, volume, type = "sine") {
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, start);
  oscillator.connect(gain);
  gain.connect(context.destination);
  gain.gain.setValueAtTime(volume, start);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  oscillator.start(start);
  oscillator.stop(start + duration);
}

function renderResult(snapshot) {
  const game = snapshot.game;
  if (game.status !== "FINISHED") return;

  const myScore = game.scores[snapshot.playerId]?.totalScore || 0;
  const opponentScore = snapshot.opponent ? game.scores[snapshot.opponent.id]?.totalScore || 0 : 0;
  if (game.winnerId == null) {
    els.resultTitle.textContent = "무승부";
  } else {
    els.resultTitle.textContent = game.winnerId === snapshot.playerId ? "승리!" : "패배";
  }
  els.resultScore.textContent = `내 점수 ${myScore} / 상대 점수 ${opponentScore}${game.finishedReason ? ` · ${game.finishedReason}` : ""}`;
}

async function leaveRoom() {
  if (state.roomCode && state.playerId) {
    await api("/api/leave-room", { roomCode: state.roomCode, playerId: state.playerId }).catch(() => {});
  }
  localStorage.removeItem("tikatoka.roomCode");
  localStorage.removeItem("tikatoka.playerId");
  state.roomCode = "";
  state.playerId = "";
  state.snapshot = null;
  if (state.eventSource) state.eventSource.close();
  els.resultModal.classList.add("hidden");
  show("start");
}

function setError(message) {
  els.startError.textContent = message;
}

function emptyBoard() {
  return Array.from({ length: 3 }, () => Array(3).fill(null));
}

function cellValue(cell) {
  return cell && typeof cell === "object" ? cell.value : cell;
}

function isLineFull(row) {
  return row.every((cell) => cell != null);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => {
    const map = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
    return map[char];
  });
}

if (state.roomCode && state.playerId) {
  connectEvents();
}
