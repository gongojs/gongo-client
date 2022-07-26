import Database from "./Database";
import Collection from "./Collection";
import { Document } from "./Collection";
import Cursor from "./Cursor";

const db = new Database();

export { Database, Collection, Cursor, Document };
export default db;

/*
  TODO
    * subscriptions
    * syncing
    * serialization
    * update/remove
    * local
 */
