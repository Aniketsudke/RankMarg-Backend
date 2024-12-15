import { WebSocket } from "ws";
import { GAME_ALERT } from "./messages";
import { Challenge } from "./Challenge";
import { db } from "./db";
import { socketManager, User } from "./SocketManager";

export class ChallengeManager {
  private challenges: Challenge[];
  private pendingChallengeId: string | null;
  private users: User[];

  constructor() {
    this.challenges = [];
    this.pendingChallengeId = null;
    this.users = [];
  }

  addUser(user: User) {
    this.users.push(user);
    this.addHandler(user);
  }

  removeUser(socket: WebSocket) {
    const user = this.users.find((user) => user.socket === socket);
    if (!user) {
      console.error("User not found?");
      return;
    }
    this.users = this.users.filter((user) => user.socket !== socket);
    socketManager.removeUser(user);
  }

  removeGame(challengeId: string) {
    this.challenges = this.challenges.filter(
      (g) => g.challengeId !== challengeId
    );
  }

  createChallenge(user: User) {
    const challenge = new Challenge(user.userId, null);

    this.challenges.push(challenge);
    this.pendingChallengeId = challenge.challengeId;
    socketManager.addUser(user, challenge.challengeId);
    socketManager.broadcast(
      challenge.challengeId,
      JSON.stringify({
        type: "CHALLENGE_ADD",
        challengeId: challenge.challengeId,
      })
    );
  }

  private addHandler(user: User) {
    user.socket.on("message", async (data) => {
      const message = JSON.parse(data.toString());
      if (message.type === "INIT_CHALLENGE") {
        if (message.payload.invite) {
          this.createChallenge(user);
        } else {
          if (this.pendingChallengeId) {
            const challenge = this.challenges.find(
              (x) => x.challengeId === this.pendingChallengeId
            );
            if (!challenge) {
              console.error("Pending challenge not found?");
              return;
            }
            if (user.userId === challenge.player1Id) {
              socketManager.broadcast(
                challenge.challengeId,
                JSON.stringify({
                  type: GAME_ALERT,
                  payload: {
                    message: "Trying to Connect with yourself?",
                  },
                })
              );
              return;
            }
            socketManager.addUser(user, challenge.challengeId);
            await challenge?.updateSecondPlayer(user.userId);
            this.pendingChallengeId = null;
          } else {
            this.createChallenge(user);
          }
        }
        user.socket.send(
          JSON.stringify({
            type: "INIT_CHALLENGE",
            payload: {
              invite: message.payload.invite,
            },
          })
        );
      }

      if (message.type === "CHALLENGE_UPDATE") {
        const challengeId = message.payload.challengeId;
        const challenge = this.challenges.find(
          (challenge) => challenge.challengeId === challengeId
        );
        if (challenge) {
          challenge.answerQuestion(
            user,
            message.payload.questionId,
            message.payload.isCorrect
          );
          if (challenge.result) {
            this.removeGame(challenge.challengeId);
          }
        }
      }

      if (message.type === "CHALLENGE_EXIT") {
        const challengeId = message.payload.challengeId;
        const challenge = this.challenges.find(
          (challenge) => challenge.challengeId === challengeId
        );

        if (challenge) {
          this.removeGame(challenge.challengeId);
        }
      }

      if (message.type === "CHALLENGE_JOIN") {
        const challengeId = message.payload?.challengeId;
        if (!challengeId) {
          return;
        }

        let availableGame = this.challenges.find(
          (challenge) => challenge.challengeId === challengeId
        );
        const challengeFromDb = await db.challenge.findUnique({
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
            user.socket.send(
              JSON.stringify({
                type: "CHALLENGE_ALERT",
                payload: {
                  message: "Trying to Connect with yourself?",
                },
              })
            );
            return;
          }
          socketManager.addUser(user, availableGame.challengeId);
          await availableGame.updateSecondPlayer(user.userId);
          return;
        }

        if (!challengeFromDb) {
          user.socket.send(
            JSON.stringify({
              type: "CHALLENGE_ALERT",
              payload: {
                message: "Challenge not found",
              },
            })
          );
          return;
        }

        const questions = challengeFromDb.ChallengeQuestion.map(
          (q) => q.question
        );

        if (challengeFromDb.status !== "IN_PROGRESS") {
          user.socket.send(
            JSON.stringify({
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
                  id: challengeFromDb.player2?.id,
                  username: challengeFromDb.player2?.username,
                  attempt: challengeFromDb.attemptByPlayer2,
                  rank: challengeFromDb.player2Score,
                },
              },
            })
          );
          return;
        }

        //TODO: Some issue here
        if (!availableGame) {
          const challenge = new Challenge(
            challengeFromDb?.player1Id!,
            challengeFromDb?.player2Id!,
            challengeId
          );
          // challenge.seedMoves(challengeFromDb?.moves || []);
          this.challenges.push(challenge);
          availableGame = challenge;
        }
        if (
          availableGame?.player1Id !== user.userId &&
          availableGame?.player2Id !== user.userId
        ) {
          user.socket.send(
            JSON.stringify({
              type: "CHALLENGE_ALERT",
              payload: {
                message: "You are not part of this game",
              },
            })
          );
          return;
        }

        user.socket.send(
          JSON.stringify({
            type: "CHALLENGE_JOIN",
            payload: {
              challengeId,
              questions: questions,
              player1: challengeFromDb.player1Id,
              player2: challengeFromDb.player2Id,
            },
          })
        );

        socketManager.addUser(user, challengeId);
      }
      if (message.type === "USER_REMOVE") {
        socketManager.removeUser(user);
        // db.challenge.delete({
        //   where: {
        //     challengeId: this.pendingChallengeId ?? undefined,
        //   },
        // });
        this.pendingChallengeId = null;
      }
    });
  }
}
