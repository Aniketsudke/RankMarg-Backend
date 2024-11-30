import jwt from "jsonwebtoken";
import { User } from "../SocketManager";
import { WebSocket } from "ws";

import dotenv from "dotenv";

// Load environment variables from .env file
dotenv.config({ path: "../../../.env" });

const JWT_SECRET =
  process.env.JWT_SECRET || "1//04J9Z1Z1Z1Z1ZCgYIARAAGAQSNwF-L9I";

export interface userJwtClaims {
  id: string;
  username: string;
  isGuest?: boolean;
}

export const extractAuthUser = (token: string, ws: WebSocket): User => {
  const decoded = jwt.verify(token, JWT_SECRET) as userJwtClaims;
  return new User(ws, decoded);
};
