export const TURN_LIMIT_SECONDS = 15;

export function createEmptyBoard() {
  return Array.from({ length: 3 }, () => Array(3).fill(null));
}

export function rollDice() {
  return Math.floor(Math.random() * 6) + 1;
}

export function createCell(value, protectedDice = false) {
  return { value, protected: protectedDice };
}

export function cellValue(cell) {
  return cell && typeof cell === "object" ? cell.value : cell;
}

export function isProtectedCell(cell) {
  return Boolean(cell && typeof cell === "object" && cell.protected);
}

export function calculateLineScore(values) {
  const counts = new Map();
  for (const cell of values) {
    const value = cellValue(cell);
    if (value == null) continue;
    counts.set(value, (counts.get(value) || 0) + 1);
  }

  let score = 0;
  for (const [value, count] of counts.entries()) {
    score += value * count + value * (count - 1);
  }
  return score;
}

export function calculateBoardScore(board) {
  const lineScores = board.map(calculateLineScore);
  const totalScore = lineScores.reduce((sum, score) => sum + score, 0);
  return { lineScores, totalScore };
}

export function isBoardFull(board) {
  return board.every((row) => row.every((cell) => cell != null));
}

export function getEmptyCells(board) {
  const cells = [];
  for (let row = 0; row < 3; row += 1) {
    for (let col = 0; col < 3; col += 1) {
      if (board[row][col] == null) cells.push({ row, col });
    }
  }
  return cells;
}

export function getPlayableRows(board) {
  return board
    .map((row, index) => (row.some((cell) => cell == null) ? index : null))
    .filter((row) => row != null);
}

export function createGame(playerIds) {
  const boards = Object.fromEntries(playerIds.map((id) => [id, createEmptyBoard()]));
  const scores = Object.fromEntries(playerIds.map((id) => [id, calculateBoardScore(boards[id])]));
  const rerollsUsed = Object.fromEntries(playerIds.map((id) => [id, false]));

  return {
    status: "PLAYING",
    playerOrder: [...playerIds],
    currentTurnPlayerId: playerIds[0],
    currentDiceValue: rollDice(),
    currentDiceProtected: true,
    diceOptions: null,
    rerollsUsed,
    bonusPlacement: null,
    boards,
    scores,
    turnStartedAt: Date.now(),
    turnLimitSeconds: TURN_LIMIT_SECONDS,
    winnerId: null,
    finishedReason: null,
    events: ["게임이 시작되었습니다.", "선턴의 첫 주사위는 파괴불가입니다."]
  };
}

export function rerollDice(game, playerId) {
  assertPlayableTurn(game, playerId);
  if (game.rerollsUsed[playerId]) throw new Error("리롤권을 이미 사용했습니다.");
  if (game.diceOptions) throw new Error("이미 리롤한 주사위 중 선택해야 합니다.");

  game.rerollsUsed[playerId] = true;
  game.diceOptions = [game.currentDiceValue, rollDice()];
  game.turnStartedAt = Date.now();
  game.events = [`${game.diceOptions[0]} 또는 ${game.diceOptions[1]} 중 선택할 수 있습니다.`];
  return game;
}

export function selectDice(game, playerId, value) {
  assertPlayableTurn(game, playerId);
  if (!game.diceOptions) throw new Error("선택 가능한 리롤 주사위가 없습니다.");
  const dice = Number(value);
  if (!game.diceOptions.includes(dice)) throw new Error("선택할 수 없는 주사위입니다.");

  game.currentDiceValue = dice;
  game.diceOptions = null;
  game.events = [`${dice}을 선택했습니다.`];
  return game;
}

export function placeDice(game, playerId, row, options = {}) {
  assertPlayableTurn(game, playerId);
  if (game.diceOptions) throw new Error("리롤 주사위 중 하나를 먼저 선택하세요.");
  if (!Number.isInteger(row) || row < 0 || row > 2) {
    throw new Error("올바르지 않은 행입니다.");
  }

  const isBonus = Boolean(game.bonusPlacement);
  const targetPlayerId = isBonus ? options.targetPlayerId || playerId : playerId;
  if (!game.boards[targetPlayerId]) throw new Error("올바르지 않은 대상입니다.");
  if (!isBonus && targetPlayerId !== playerId) throw new Error("일반 주사위는 내 보드에만 둘 수 있습니다.");

  const board = game.boards[targetPlayerId];
  if (!board[row].some((cell) => cell == null)) {
    throw new Error("빈 칸이 있는 행만 선택할 수 있습니다.");
  }

  const dice = game.currentDiceValue;
  const protectedDice = game.currentDiceProtected || isBonus;
  const placedCell = createCell(dice, protectedDice);
  board[row] = insertDiceToRow(board[row], placedCell);

  let removed = 0;
  if (!isBonus && targetPlayerId === playerId) {
    removed = removeOpponentDice(game, playerId, row, dice);
  }

  refreshScores(game);
  const rowName = ["위", "가운데", "아래"][row];
  const targetText = targetPlayerId === playerId ? "내" : "상대";
  const protectedText = protectedDice ? " 파괴불가" : "";
  const auto = options.auto ? "시간 초과로 " : "";
  const events = [`${auto}${protectedText} ${dice}을 ${targetText} ${rowName} 행에 배치했습니다.`.trim()];
  if (removed > 0) events.push(`상대 ${dice} 주사위 ${removed}개를 쳐냈습니다.`);

  if (removed > 0) {
    board[row] = removePlacedCell(board[row], placedCell);
    refreshScores(game);
    game.bonusPlacement = { playerId, fromRow: row };
    game.currentDiceValue = rollDice();
    game.currentDiceProtected = true;
    game.diceOptions = null;
    game.turnStartedAt = Date.now();
    game.events = [
      `${auto}${dice} 알까기로 상대 ${dice} 주사위 ${removed}개를 쳐냈습니다.`,
      "공격 주사위와 쳐낸 주사위는 사라집니다.",
      "새 파괴불가 주사위를 배치합니다."
    ];
    return game;
  }

  game.bonusPlacement = null;
  advanceTurnOrFinish(game);
  game.events = [...events, game.status === "FINISHED" ? "게임이 종료되었습니다." : "다음 턴으로 넘어갑니다."];
  return game;
}

export function autoPlaceDice(game) {
  if (game.diceOptions) {
    game.currentDiceValue = game.diceOptions[0];
    game.diceOptions = null;
    game.events = [`시간 초과로 ${game.currentDiceValue}을 선택했습니다.`];
  }

  const playerId = game.currentTurnPlayerId;
  const targetIds = game.bonusPlacement
    ? [playerId, game.playerOrder.find((id) => id !== playerId)]
    : [playerId];

  const choices = targetIds.flatMap((targetPlayerId) =>
    getPlayableRows(game.boards[targetPlayerId]).map((row) => ({ targetPlayerId, row }))
  );
  if (choices.length === 0) {
    game.bonusPlacement = null;
    advanceTurnOrFinish(game);
    return game;
  }

  const pick = choices[Math.floor(Math.random() * choices.length)];
  return placeDice(game, playerId, pick.row, { targetPlayerId: pick.targetPlayerId, auto: true });
}

export function finishByLeave(game, winnerId) {
  game.status = "FINISHED";
  game.winnerId = winnerId;
  game.finishedReason = "상대방이 퇴장했습니다.";
  game.events = ["상대방이 퇴장했습니다."];
  return game;
}

function assertPlayableTurn(game, playerId) {
  if (game.status !== "PLAYING") throw new Error("이미 종료된 게임입니다.");
  if (game.currentTurnPlayerId !== playerId) throw new Error("현재 턴이 아닙니다.");
}

function removeOpponentDice(game, playerId, row, dice) {
  const opponentId = game.playerOrder.find((id) => id !== playerId);
  const opponentBoard = game.boards[opponentId];
  let removed = 0;

  for (let col = 0; col < 3; col += 1) {
    const cell = opponentBoard[row][col];
    if (cellValue(cell) === dice && !isProtectedCell(cell)) {
      opponentBoard[row][col] = null;
      removed += 1;
    }
  }
  opponentBoard[row] = alignRowRight(opponentBoard[row].filter((cell) => cell != null));
  return removed;
}

function refreshScores(game) {
  for (const playerId of game.playerOrder) {
    game.scores[playerId] = calculateBoardScore(game.boards[playerId]);
  }
}

function advanceTurnOrFinish(game) {
  if (game.playerOrder.every((id) => isBoardFull(game.boards[id]))) {
    finishByScore(game);
    return;
  }

  const [a, b] = game.playerOrder;
  const next = game.currentTurnPlayerId === a ? b : a;
  game.currentTurnPlayerId = isBoardFull(game.boards[next]) ? game.currentTurnPlayerId : next;
  if (isBoardFull(game.boards[game.currentTurnPlayerId])) {
    game.currentTurnPlayerId = game.playerOrder.find((id) => !isBoardFull(game.boards[id]));
  }
  game.currentDiceValue = rollDice();
  game.currentDiceProtected = false;
  game.diceOptions = null;
  game.turnStartedAt = Date.now();
}

function finishByScore(game) {
  const [a, b] = game.playerOrder;
  const result = calculateLineWinResult(game.scores[a], game.scores[b]);

  game.status = "FINISHED";
  game.winnerId = result.winner === "a" ? a : result.winner === "b" ? b : null;
  game.finishedReason = result.reason;
}

function calculateLineWinResult(scoreA, scoreB) {
  let lineWinsA = 0;
  let lineWinsB = 0;

  for (let index = 0; index < 3; index += 1) {
    const lineA = scoreA.lineScores[index] || 0;
    const lineB = scoreB.lineScores[index] || 0;
    if (lineA > lineB) lineWinsA += 1;
    if (lineB > lineA) lineWinsB += 1;
  }

  if (lineWinsA > lineWinsB) return { winner: "a", reason: "라인 승리" };
  if (lineWinsB > lineWinsA) return { winner: "b", reason: "라인 승리" };
  if (scoreA.totalScore > scoreB.totalScore) return { winner: "a", reason: "라인 동률, 총점 승리" };
  if (scoreB.totalScore > scoreA.totalScore) return { winner: "b", reason: "라인 동률, 총점 승리" };
  return { winner: null, reason: "무승부" };
}

function insertDiceToRow(row, cell) {
  const values = row.filter((value) => value != null);
  const lastSameIndex = findLastIndex(values, (item) => cellValue(item) === cell.value);
  if (lastSameIndex === -1) {
    values.unshift(cell);
  } else {
    values.splice(lastSameIndex + 1, 0, cell);
  }
  return alignRowRight(values);
}

function alignRowRight(values) {
  return [...Array(3 - values.length).fill(null), ...values];
}

function removePlacedCell(row, placedCell) {
  const values = row.filter((cell) => cell != null && cell !== placedCell);
  return alignRowRight(values);
}

function findLastIndex(values, predicate) {
  for (let index = values.length - 1; index >= 0; index -= 1) {
    if (predicate(values[index])) return index;
  }
  return -1;
}
