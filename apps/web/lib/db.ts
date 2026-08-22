import "server-only";
import { getDb, type Db } from "@prospection/core";
import { env } from "./env";

export function db(): Db {
  return getDb(env().DATABASE_URL);
}
