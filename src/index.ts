import { WebSocketServer } from "ws";
import { ChallengeManager } from "./ChallengeManager";
import url from "url";
import { extractAuthUser } from "./auth";
import { User } from "./SocketManager";

const wss = new WebSocketServer({ port: 8080 });

const challengeManager = new ChallengeManager();

wss.on("connection", function connection(ws, req) {
  //@ts-ignore
  const token: string = url.parse(req.url, true).query.token;
  const user = extractAuthUser(token, ws);
  // let user;
  // if (token === "1") {
  //   user = new User(ws, {
  //     id: "4152aae6-6c9f-4b60-9a1c-92c6252f6709",
  //     username: "framex07",
  //   });
  // } else {
  //   user = new User(ws, {
  //     id: "a69cb423-9804-4bc7-a620-f80b8b4a9d68",
  //     username: "Aniket Sudke",
  //   });
  // }
  challengeManager.addUser(user);

  ws.on("close", () => {
    challengeManager.removeUser(ws);
  });
});
