import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateBoardScore,
  calculateLineScore,
  cellValue,
  createCell,
  createGame,
  getEmptyCells,
  placeDice,
  rerollDice,
  selectDice
} from "./gameEngine.js";

const values = (row) => row.map(cellValue);

test("scores duplicate dice with linear link bonus", () => {
  assert.equal(calculateLineScore([6, 6, 6]), 30);
  assert.equal(calculateLineScore([3, 3, 5]), 14);
  assert.equal(calculateLineScore([3, 5, 5]), 18);
  assert.equal(calculateBoardScore([[2, 4, 6], [3, 3, 5], [null, null, 6]]).totalScore, 32);
});

test("placing a dice inserts into the selected row and links same values", () => {
  const game = createGame(["a", "b"]);
  game.currentTurnPlayerId = "a";
  game.currentDiceValue = 5;
  game.currentDiceProtected = false;
  game.boards.a = [[null, null, null], [null, createCell(3), createCell(5)], [null, null, null]];

  placeDice(game, "a", 1);

  assert.deepEqual(values(game.boards.a[1]), [3, 5, 5]);
});

test("placing a different dice fills the left side of the current right-aligned stack", () => {
  const game = createGame(["a", "b"]);
  game.currentTurnPlayerId = "a";
  game.currentDiceValue = 5;
  game.currentDiceProtected = false;
  game.boards.a = [[null, null, createCell(3)], [null, null, null], [null, null, null]];

  placeDice(game, "a", 0);

  assert.deepEqual(values(game.boards.a[0]), [null, 5, 3]);
});

test("first player first dice is protected", () => {
  const game = createGame(["a", "b"]);
  game.currentTurnPlayerId = "a";
  game.currentDiceValue = 4;

  placeDice(game, "a", 0);

  assert.equal(game.boards.a[0][2].protected, true);
});

test("hitting removable opponent dice grants a protected bonus placement", () => {
  const game = createGame(["a", "b"]);
  game.currentTurnPlayerId = "a";
  game.currentDiceValue = 5;
  game.currentDiceProtected = false;
  game.boards.b = [[null, null, null], [createCell(5), createCell(2), createCell(5)], [null, null, null]];

  placeDice(game, "a", 1);

  assert.deepEqual(values(game.boards.a[1]), [null, null, null]);
  assert.deepEqual(values(game.boards.b[1]), [null, null, 2]);
  assert.equal(game.currentTurnPlayerId, "a");
  assert.equal(game.currentDiceProtected, true);
  assert.deepEqual(game.bonusPlacement.playerId, "a");

  placeDice(game, "a", 2, { targetPlayerId: "b" });

  assert.equal(game.boards.b[2][2].protected, true);
  assert.equal(game.currentTurnPlayerId, "b");
});

test("protected opponent dice are not removed", () => {
  const game = createGame(["a", "b"]);
  game.currentTurnPlayerId = "a";
  game.currentDiceValue = 5;
  game.currentDiceProtected = false;
  game.boards.b = [[null, null, null], [createCell(5, true), createCell(2), createCell(5)], [null, null, null]];

  placeDice(game, "a", 1);

  assert.deepEqual(values(game.boards.a[1]), [null, null, null]);
  assert.deepEqual(values(game.boards.b[1]), [null, 5, 2]);
  assert.equal(game.bonusPlacement.playerId, "a");
});

test("linked protected and removable dice only lose removable dice when hit", () => {
  const game = createGame(["a", "b"]);
  game.currentTurnPlayerId = "a";
  game.currentDiceValue = 5;
  game.currentDiceProtected = false;
  game.boards.b = [[null, null, null], [createCell(5, true), createCell(5), createCell(2)], [null, null, null]];

  placeDice(game, "a", 1);

  assert.deepEqual(values(game.boards.b[1]), [null, 5, 2]);
  assert.equal(game.boards.b[1][1].protected, true);
});

test("reroll gives one choice pair and selected dice is used", () => {
  const game = createGame(["a", "b"]);
  game.currentTurnPlayerId = "a";
  game.currentDiceValue = 2;

  rerollDice(game, "a");
  assert.equal(game.diceOptions.length, 2);
  selectDice(game, "a", game.diceOptions[1]);
  assert.equal(game.diceOptions, null);
  assert.throws(() => rerollDice(game, "a"), /이미 사용/);
});

test("rejects full rows and wrong turns", () => {
  const game = createGame(["a", "b"]);
  game.currentTurnPlayerId = "a";
  game.boards.a[0] = [createCell(1), createCell(2), createCell(3)];

  assert.throws(() => placeDice(game, "b", 1), /현재 턴/);
  assert.throws(() => placeDice(game, "a", 0), /빈 칸/);
});

test("keeps playing until both boards are full", () => {
  const game = createGame(["a", "b"]);
  game.boards.a = [
    [createCell(1), createCell(1), createCell(1)],
    [createCell(2), createCell(2), createCell(2)],
    [createCell(3), createCell(3), null]
  ];
  game.boards.b = [
    [createCell(1), createCell(2), createCell(3)],
    [createCell(4), createCell(5), createCell(6)],
    [null, null, null]
  ];
  game.currentTurnPlayerId = "a";
  game.currentDiceValue = 4;
  game.currentDiceProtected = false;

  placeDice(game, "a", 2);

  assert.equal(game.status, "PLAYING");
  assert.equal(game.currentTurnPlayerId, "b");
  assert.equal(getEmptyCells(game.boards.a).length, 0);
});

test("winner is decided by line wins before total score", () => {
  const game = createGame(["a", "b"]);
  game.boards.a = [
    [createCell(6), createCell(6), createCell(6)],
    [createCell(1), createCell(2), createCell(3)],
    [null, createCell(2), createCell(3)]
  ];
  game.boards.b = [
    [createCell(1), createCell(1), createCell(1)],
    [createCell(2), createCell(2), createCell(2)],
    [createCell(2), createCell(2), createCell(2)]
  ];
  game.currentTurnPlayerId = "a";
  game.currentDiceValue = 1;
  game.currentDiceProtected = false;

  placeDice(game, "a", 2);

  assert.equal(game.status, "FINISHED");
  assert.equal(game.scores.a.totalScore > game.scores.b.totalScore, true);
  assert.equal(game.winnerId, "b");
  assert.equal(game.finishedReason, "라인 승리");
});
