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
exports.ChallengeManager = void 0;
const messages_1 = require("./messages");
const Challenge_1 = require("./Challenge");
const db_1 = require("./db");
const SocketManager_1 = require("./SocketManager");
class ChallengeManager {
    constructor() {
        this.challenges = [];
        this.pendingChallengeId = null;
        this.users = [];
    }
    addUser(user) {
        this.users.push(user);
        this.addHandler(user);
    }
    removeUser(socket) {
        const user = this.users.find((user) => user.socket === socket);
        if (!user) {
            console.error("User not found?");
            return;
        }
        this.users = this.users.filter((user) => user.socket !== socket);
        SocketManager_1.socketManager.removeUser(user);
    }
    removeGame(challengeId) {
        this.challenges = this.challenges.filter((g) => g.challengeId !== challengeId);
    }
    createChallenge(user) {
        const challenge = new Challenge_1.Challenge(user.userId, null);
        this.challenges.push(challenge);
        this.pendingChallengeId = challenge.challengeId;
        SocketManager_1.socketManager.addUser(user, challenge.challengeId);
        SocketManager_1.socketManager.broadcast(challenge.challengeId, JSON.stringify({
            type: "CHALLENGE_ADD",
            challengeId: challenge.challengeId,
        }));
    }
    addHandler(user) {
        user.socket.on("message", (data) => __awaiter(this, void 0, void 0, function* () {
            var _a, _b, _c;
            const message = JSON.parse(data.toString());
            if (message.type === "INIT_CHALLENGE") {
                if (message.payload.invite) {
                    this.createChallenge(user);
                }
                else {
                    if (this.pendingChallengeId) {
                        const challenge = this.challenges.find((x) => x.challengeId === this.pendingChallengeId);
                        if (!challenge) {
                            console.error("Pending challenge not found?");
                            return;
                        }
                        if (user.userId === challenge.player1Id) {
                            SocketManager_1.socketManager.broadcast(challenge.challengeId, JSON.stringify({
                                type: messages_1.GAME_ALERT,
                                payload: {
                                    message: "Trying to Connect with yourself?",
                                },
                            }));
                            return;
                        }
                        SocketManager_1.socketManager.addUser(user, challenge.challengeId);
                        yield (challenge === null || challenge === void 0 ? void 0 : challenge.updateSecondPlayer(user.userId));
                        this.pendingChallengeId = null;
                    }
                    else {
                        this.createChallenge(user);
                    }
                }
                user.socket.send(JSON.stringify({
                    type: "INIT_CHALLENGE",
                    payload: {
                        invite: message.payload.invite,
                    },
                }));
            }
            if (message.type === "CHALLENGE_UPDATE") {
                const challengeId = message.payload.challengeId;
                const challenge = this.challenges.find((challenge) => challenge.challengeId === challengeId);
                if (challenge) {
                    challenge.answerQuestion(user, message.payload.questionId, message.payload.isCorrect);
                    if (challenge.result) {
                        this.removeGame(challenge.challengeId);
                    }
                }
            }
            if (message.type === "CHALLENGE_EXIT") {
                const challengeId = message.payload.challengeId;
                const challenge = this.challenges.find((challenge) => challenge.challengeId === challengeId);
                if (challenge) {
                    this.removeGame(challenge.challengeId);
                }
            }
            if (message.type === "CHALLENGE_JOIN") {
                const challengeId = (_a = message.payload) === null || _a === void 0 ? void 0 : _a.challengeId;
                if (!challengeId) {
                    return;
                }
                let availableGame = this.challenges.find((challenge) => challenge.challengeId === challengeId);
                const challengeFromDb = yield db_1.db.challenge.findUnique({
                    where: { challengeId },
                    include: {
                        ChallengeQuestion: {
                            include: {
                                question: {
                                    include: {
                                        options: true,
                                    },
                                },
                            },
                        },
                        player1: true,
                        player2: true,
                    },
                });
                if (availableGame && !availableGame.player2Id) {
                    if (availableGame.player1Id === user.userId) {
                        user.socket.send(JSON.stringify({
                            type: "CHALLENGE_ALERT",
                            payload: {
                                message: "Trying to Connect with yourself?",
                            },
                        }));
                        return;
                    }
                    SocketManager_1.socketManager.addUser(user, availableGame.challengeId);
                    yield availableGame.updateSecondPlayer(user.userId);
                    return;
                }
                if (!challengeFromDb) {
                    user.socket.send(JSON.stringify({
                        type: "CHALLENGE_ALERT",
                        payload: {
                            message: "Challenge not found",
                        },
                    }));
                    return;
                }
                const questions = challengeFromDb.ChallengeQuestion.map((q) => q.question);
                if (challengeFromDb.status !== "IN_PROGRESS") {
                    user.socket.send(JSON.stringify({
                        type: "CHALLENGE_OVER",
                        payload: {
                            result: challengeFromDb.result,
                            status: challengeFromDb.status,
                            questions: questions,
                            player1: {
                                id: challengeFromDb.player1.id,
                                username: challengeFromDb.player1.username,
                                attempt: challengeFromDb.attemptByPlayer1,
                                rank: challengeFromDb.player1Score,
                            },
                            player2: {
                                id: (_b = challengeFromDb.player2) === null || _b === void 0 ? void 0 : _b.id,
                                username: (_c = challengeFromDb.player2) === null || _c === void 0 ? void 0 : _c.username,
                                attempt: challengeFromDb.attemptByPlayer2,
                                rank: challengeFromDb.player2Score,
                            },
                        },
                    }));
                    return;
                }
                //TODO: Some issue here
                if (!availableGame) {
                    const challenge = new Challenge_1.Challenge(challengeFromDb === null || challengeFromDb === void 0 ? void 0 : challengeFromDb.player1Id, challengeFromDb === null || challengeFromDb === void 0 ? void 0 : challengeFromDb.player2Id, challengeId);
                    // challenge.seedMoves(challengeFromDb?.moves || []);
                    this.challenges.push(challenge);
                    availableGame = challenge;
                }
                if ((availableGame === null || availableGame === void 0 ? void 0 : availableGame.player1Id) !== user.userId &&
                    (availableGame === null || availableGame === void 0 ? void 0 : availableGame.player2Id) !== user.userId) {
                    user.socket.send(JSON.stringify({
                        type: "CHALLENGE_ALERT",
                        payload: {
                            message: "You are not part of this game",
                        },
                    }));
                    return;
                }
                user.socket.send(JSON.stringify({
                    type: "CHALLENGE_JOIN",
                    payload: {
                        challengeId,
                        questions: questions,
                        player1: challengeFromDb.player1Id,
                        player2: challengeFromDb.player2Id,
                    },
                }));
                SocketManager_1.socketManager.addUser(user, challengeId);
            }
            if (message.type === "USER_REMOVE") {
                SocketManager_1.socketManager.removeUser(user);
                // db.challenge.delete({
                //   where: {
                //     challengeId: this.pendingChallengeId ?? undefined,
                //   },
                // });
                this.pendingChallengeId = null;
            }
        }));
    }
}
exports.ChallengeManager = ChallengeManager;
