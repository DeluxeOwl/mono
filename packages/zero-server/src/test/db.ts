import postgres from 'postgres';
import {assert} from 'shared/src/asserts.js';

export class TestDBs {
  // Connects to the main "postgres" DB of the local Postgres cluster.
  readonly #sql = postgres({
    database: 'postgres',
    transform: postgres.camel,
    onnotice: () => {},
  });
  readonly #dbs: Record<string, postgres.Sql> = {};

  async createAndConnect(database: string) {
    assert(!(database in this.#dbs), `${database} has already been created`);
    await this.#sql`DROP DATABASE IF EXISTS ${this.#sql(database)}`;
    await this.#sql`CREATE DATABASE ${this.#sql(database)}`;
    const db = postgres({
      database,
      transform: postgres.camel,
      onnotice: () => {},
    });
    this.#dbs[database] = db;
    return db;
  }

  async closeAndDrop(database: string) {
    const db = this.#dbs[database];
    assert(db, `${database} does not exist`);
    await db.end();
    await this.#sql`DROP DATABASE IF EXISTS ${this.#sql(db.options.database)}`;
  }

  async end() {
    await Promise.all(
      [...Object.keys(this.#dbs)].map(db => this.closeAndDrop(db)),
    );
    return this.#sql.end();
  }
}
