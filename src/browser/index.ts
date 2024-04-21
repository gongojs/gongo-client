import Database from "./Database";
import Collection from "./Collection";
import type { WithId, OptionalId, GongoClientDocument } from "./Collection";
import Cursor from "./Cursor";

const db = new Database();

export { Database, Collection, Cursor };
export type { WithId, OptionalId, GongoClientDocument };
export default db;

/*
  TODO
    * subscriptions
    * syncing
    * serialization
    * update/remove
    * local
 */
