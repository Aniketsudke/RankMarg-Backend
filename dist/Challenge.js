"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Challenge = void 0;
const crypto_1 = require("crypto");
const SocketManager_1 = require("./SocketManager");
const db_1 = require("./db");
class Challenge {
    constructor(player1UserId, player2UserId, questionCount, challengeId, startTime) {
        this.result = null;
        this.questions = [];
        this.player1Score = [];
        this.player2Score = [];
        this.startTime = new Date(Date.now());
        this.timeoutId = null;
        this.timeLimit = 100000;
        this.player1Id = player1UserId;
        this.player2Id = player2UserId;
        this.challengeId = challengeId !== null && challengeId !== void 0 ? challengeId : (0, crypto_1.randomUUID)();
        if (!questionCount) {
            questionCount = 2;
        }
        this.loadRandomQuestions(questionCount);
        if (startTime) {
            this.startTime = startTime;
        }
    }
    startChallengeTimer() {
        this.timeoutId = setInterval(() => {
            const elapsedTime = Date.now() - this.startTime.getTime();
            const remainingTime = this.timeLimit - elapsedTime;
            if (remainingTime <= 0) {
                clearInterval(this.timeoutId);
                this.endChellenge();
            }
            else {
                // console.log("Remaining time:", remainingTime);
                // Emit the remaining time to the frontend
            }
        }, 1000);
    }
    loadRandomQuestions(questionCount) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                const questions = yield db_1.db.$queryRaw `
      SELECT * FROM "Question" 
      ORDER BY RANDOM() 
      LIMIT ${questionCount}
  `;
                this.timeCalculate();
                this.questions.push(...questions);
            }
            catch (error) {
                console.error("Error fetching questions:", error);
            }
        });
    }
    timeCalculate() {
        if (this.questions.length > 0) {
            this.questions.forEach((question) => {
                if (question.questionTime)
                    this.timeLimit += question.questionTime;
            });
        }
    }
    answerQuestion(user, questionId, isCorrect) {
        return __awaiter(this, void 0, void 0, function* () {
            const question = this.questions.find((q) => {
                return q.id === questionId;
            });
            if (!question) {
                console.error("Question not found?");
                return;
            }
            if (user.userId === this.player1Id) {
                this.player1Score.push(isCorrect ? 1 : 0);
                // this.player1Times.push(timeTaken);
            }
            else {
                this.player2Score.push(isCorrect ? 1 : 0);
                // this.player2Times.push(timeTaken);
            }
            SocketManager_1.socketManager.broadcast(this.challengeId, JSON.stringify({
                type: "QUESTION_ANSWERED",
                payload: {
                    questionId,
                    isCorrect,
                    player1Answers: this.player1Score,
                    player2Answers: this.player2Score,
                },
            }));
            if (this.isChallengeOver()) {
                this.endChellenge();
            }
        });
    }
    isChallengeOver() {
        return (this.player1Score.length === this.questions.length &&
            this.player2Score.length === this.questions.length);
    }
    endChellenge() {
        return __awaiter(this, void 0, void 0, function* () {
            clearInterval(this.timeoutId);
            const player1TotalScore = this.player1Score.reduce((a, b) => a + b, 0); // Sum of player 1 scores
            const player2TotalScore = this.player2Score.reduce((a, b) => a + b, 0);
            this.result =
                player1TotalScore > player2TotalScore
                    ? this.player1Id
                    : player1TotalScore < player2TotalScore
                        ? this.player2Id
                        : "DRAW";
            const player1 = yield db_1.db.user.findUnique({
                where: {
                    id: this.player1Id,
                },
                select: {
                    username: true,
                    rank: true,
                },
            });
            const player2 = yield db_1.db.user.findUnique({
                where: {
                    id: this.player2Id || "",
                },
                select: {
                    username: true,
                    rank: true,
                },
            });
            if (!player1 || !player2)
                return;
            const K_FACTOR = 10;
            const expectedScore1 = 1 / (1 + Math.pow(10, (player2.rank - player1.rank) / 400));
            const expectedScore2 = 1 - expectedScore1;
            let actualScore1, actualScore2;
            if (this.result === this.player1Id) {
                actualScore1 = 1;
                actualScore2 = 0;
            }
            else if (this.result === this.player2Id) {
                actualScore1 = 0;
                actualScore2 = 1;
            }
            else {
                actualScore1 = 0.5;
                actualScore2 = 0.5;
            }
            const newPlayer1Rank = Math.round(player1.rank + K_FACTOR * (actualScore1 - expectedScore1));
            const newPlayer2Rank = Math.round(player2.rank + K_FACTOR * (actualScore2 - expectedScore2));
            yield db_1.db.user.update({
                where: {
                    id: this.player1Id,
                },
                data: {
                    rank: newPlayer1Rank,
                },
            });
            yield db_1.db.user.update({
                where: {
                    id: this.player2Id || "",
                },
                data: {
                    rank: newPlayer2Rank,
                },
            });
            const Player1rankChange = newPlayer1Rank - player1.rank;
            const Player2rankChange = newPlayer2Rank - player2.rank;
            SocketManager_1.socketManager.broadcast(this.challengeId, JSON.stringify({
                type: "CHALLENGE_OVER",
                payload: {
                    result: this.result,
                    questions: this.questions,
                    player1: {
                        id: this.player1Id,
                        username: player1.username,
                        attempt: this.player1Score,
                        rank: Player1rankChange,
                    },
                    player2: {
                        id: this.player2Id,
                        username: player2.username,
                        attempt: this.player2Score,
                        rank: Player2rankChange,
                    },
                },
            }));
            yield db_1.db.challenge.update({
                where: {
                    challengeId: this.challengeId,
                },
                data: {
                    status: "COMPLETED",
                    // endAt: new Date(Date.now()),
                    result: this.result,
                    attemptByPlayer1: this.player1Score,
                    attemptByPlayer2: this.player2Score,
                    player1Score: newPlayer1Rank - player1.rank,
                    player2Score: newPlayer2Rank - player2.rank,
                },
            });
        });
    }
    updateSecondPlayer(player2Id) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a;
            this.player2Id = player2Id;
            const users = yield db_1.db.user.findMany({
                where: {
                    id: {
                        in: [this.player1Id, (_a = this.player2Id) !== null && _a !== void 0 ? _a : ""],
                    },
                },
            });
            try {
                yield this.createGameInDb();
            }
            catch (e) {
                console.error(e);
                return;
            }
            const Player1 = users.find((user) => user.id === this.player1Id);
            const Player2 = users.find((user) => user.id === this.player2Id);
            SocketManager_1.socketManager.broadcast(this.challengeId, JSON.stringify({
                type: "CHALLENGE_START",
                payload: {
                    challengeId: this.challengeId,
                    Player1: {
                        name: Player1 === null || Player1 === void 0 ? void 0 : Player1.username,
                        id: this.player1Id,
                    },
                    Player2: {
                        name: Player2 === null || Player2 === void 0 ? void 0 : Player2.username,
                        id: this.player2Id,
                    },
                    questions: this.questions, //TODO:questions: this.questions.map(q => ({ id: q._id, content: q.content })),
                },
            }));
            this.startChallengeTimer();
        });
    }
    createGameInDb() {
        return __awaiter(this, void 0, void 0, function* () {
            var _a;
            this.startTime = new Date(Date.now());
            const challenge = yield db_1.db.challenge.create({
                data: {
                    challengeId: this.challengeId,
                    status: "IN_PROGRESS",
                    updatedAt: this.startTime,
                    player1: {
                        connect: {
                            id: this.player1Id,
                        },
                    },
                    player2: {
                        connect: {
                            id: (_a = this.player2Id) !== null && _a !== void 0 ? _a : "",
                        },
                    },
                    ChallengeQuestion: {
                        create: this.questions.map((q) => ({
                            questionId: q.id,
                        })),
                    },
                },
            });
            this.challengeId = challenge.challengeId;
        });
    }
}
exports.Challenge = Challenge;
