import { randomUUID } from "crypto";
import { socketManager, User } from "./SocketManager";
import { db } from "./db";
import { Question } from "@prisma/client";

export class Challenge {
  public challengeId: string;
  public player1Id: string;
  public player2Id: string | null;
  public result: string | null = null;
  public questions: Question[] = [];
  public player1Score: number[] = [];
  public player2Score: number[] = [];
  private startTime = new Date(Date.now());
  private timeoutId: NodeJS.Timeout | null = null;
  private timeLimit: number = 100000;

  constructor(
    player1UserId: string,
    player2UserId: string | null,
    questionCount?: number,
    challengeId?: string,
    startTime?: Date
  ) {
    this.player1Id = player1UserId;
    this.player2Id = player2UserId;
    this.challengeId = challengeId ?? randomUUID();
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
        clearInterval(this.timeoutId!);
        this.endChellenge();
      } else {
        // console.log("Remaining time:", remainingTime);
        // Emit the remaining time to the frontend
      }
    }, 1000);
  }

  async loadRandomQuestions(questionCount: number) {
    try {
      const questions: Question[] = await db.$queryRaw`
      SELECT * FROM "Question" 
      ORDER BY RANDOM() 
      LIMIT ${questionCount}
  `;
      this.timeCalculate();
      this.questions.push(...questions);
    } catch (error) {
      console.error("Error fetching questions:", error);
    }
  }

  timeCalculate() {
    if (this.questions.length > 0) {
      this.questions.forEach((question) => {
        if (question.questionTime) this.timeLimit += question.questionTime;
      });
    }
  }

  async answerQuestion(user: User, questionId: string, isCorrect: boolean) {
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
    } else {
      this.player2Score.push(isCorrect ? 1 : 0);
      // this.player2Times.push(timeTaken);
    }

    socketManager.broadcast(
      this.challengeId,
      JSON.stringify({
        type: "QUESTION_ANSWERED",
        payload: {
          questionId,
          isCorrect,
          player1Answers: this.player1Score,
          player2Answers: this.player2Score,
        },
      })
    );

    if (this.isChallengeOver()) {
      this.endChellenge();
    }
  }

  isChallengeOver() {
    return (
      this.player1Score.length === this.questions.length &&
      this.player2Score.length === this.questions.length
    );
  }

  async endChellenge() {
    clearInterval(this.timeoutId!);

    const player1TotalScore = this.player1Score.reduce((a, b) => a + b, 0); // Sum of player 1 scores
    const player2TotalScore = this.player2Score.reduce((a, b) => a + b, 0);

    this.result =
      player1TotalScore > player2TotalScore
        ? this.player1Id
        : player1TotalScore < player2TotalScore
          ? this.player2Id
          : "DRAW";

    const player1 = await db.user.findUnique({
      where: {
        id: this.player1Id,
      },
      select: {
        username: true,
        rank: true,
      },
    });

    const player2 = await db.user.findUnique({
      where: {
        id: this.player2Id || "",
      },
      select: {
        username: true,
        rank: true,
      },
    });
    if (!player1 || !player2) return;

    const K_FACTOR = 10;
    const expectedScore1 =
      1 / (1 + Math.pow(10, (player2.rank - player1.rank) / 400));
    const expectedScore2 = 1 - expectedScore1;

    let actualScore1, actualScore2;
    if (this.result === this.player1Id) {
      actualScore1 = 1;
      actualScore2 = 0;
    } else if (this.result === this.player2Id) {
      actualScore1 = 0;
      actualScore2 = 1;
    } else {
      actualScore1 = 0.5;
      actualScore2 = 0.5;
    }

    const newPlayer1Rank = Math.round(
      player1.rank + K_FACTOR * (actualScore1 - expectedScore1)
    );
    const newPlayer2Rank = Math.round(
      player2.rank + K_FACTOR * (actualScore2 - expectedScore2)
    );

    await db.user.update({
      where: {
        id: this.player1Id,
      },
      data: {
        rank: newPlayer1Rank,
      },
    });
    await db.user.update({
      where: {
        id: this.player2Id || "",
      },
      data: {
        rank: newPlayer2Rank,
      },
    });

    const Player1rankChange = newPlayer1Rank - player1.rank;
    const Player2rankChange = newPlayer2Rank - player2.rank;

    socketManager.broadcast(
      this.challengeId,
      JSON.stringify({
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
      })
    );

    await db.challenge.update({
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
  }

  async updateSecondPlayer(player2Id: string) {
    this.player2Id = player2Id;

    const users = await db.user.findMany({
      where: {
        id: {
          in: [this.player1Id, this.player2Id ?? ""],
        },
      },
    });

    try {
      await this.createGameInDb();
    } catch (e) {
      console.error(e);
      return;
    }

    const Player1 = users.find((user: any) => user.id === this.player1Id);
    const Player2 = users.find((user: any) => user.id === this.player2Id);

    socketManager.broadcast(
      this.challengeId,
      JSON.stringify({
        type: "CHALLENGE_START",
        payload: {
          challengeId: this.challengeId,
          Player1: {
            name: Player1?.username,
            id: this.player1Id,
          },
          Player2: {
            name: Player2?.username,
            id: this.player2Id,
          },
          questions: this.questions, //TODO:questions: this.questions.map(q => ({ id: q._id, content: q.content })),
        },
      })
    );
    this.startChallengeTimer();
  }
  async createGameInDb() {
    this.startTime = new Date(Date.now());

    const challenge = await db.challenge.create({
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
            id: this.player2Id ?? "",
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
  }
}
