"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const ws_1 = require("ws");
const ChallengeManager_1 = require("./ChallengeManager");
const url_1 = __importDefault(require("url"));
const auth_1 = require("./auth");
const wss = new ws_1.WebSocketServer({ port: 8080 });
const challengeManager = new ChallengeManager_1.ChallengeManager();
wss.on("connection", function connection(ws, req) {
    //@ts-ignore
    const token = url_1.default.parse(req.url, true).query.token;
    const user = (0, auth_1.extractAuthUser)(token, ws);
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
