import { Database } from "bun:sqlite";

export interface SessionRecord {
  sessionId: string;
  userSysId: string;
  userName: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  createdAt: string;
}

/**
 * Per-user OAuth session + token store (spec §4.1: token bound to one sys_user,
 * refresh rotation; the MCP server never stores IdP passwords). SQLite file by
 * default — swap the file path per deployment; secrets never ship in code.
 */
export class SessionStore {
  private readonly db: Database;

  constructor(path = ":memory:") {
    this.db = new Database(path);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        session_id TEXT PRIMARY KEY,
        user_sys_id TEXT NOT NULL,
        user_name TEXT NOT NULL,
        access_token TEXT NOT NULL,
        refresh_token TEXT,
        expires_at INTEGER,
        created_at TEXT NOT NULL
      );
    `);
  }

  create(record: SessionRecord): void {
    this.db
      .query(
        `INSERT OR REPLACE INTO sessions
         (session_id, user_sys_id, user_name, access_token, refresh_token, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.sessionId,
        record.userSysId,
        record.userName,
        record.accessToken,
        record.refreshToken ?? null,
        record.expiresAt ?? null,
        record.createdAt,
      );
  }

  get(sessionId: string): SessionRecord | null {
    const row = this.db
      .query<{
        session_id: string;
        user_sys_id: string;
        user_name: string;
        access_token: string;
        refresh_token: string | null;
        expires_at: number | null;
        created_at: string;
      }, [string]>(
        `SELECT session_id, user_sys_id, user_name, access_token, refresh_token, expires_at, created_at
         FROM sessions WHERE session_id = ?`,
      )
      .get(sessionId);
    if (!row) return null;
    return {
      sessionId: row.session_id,
      userSysId: row.user_sys_id,
      userName: row.user_name,
      accessToken: row.access_token,
      refreshToken: row.refresh_token ?? undefined,
      expiresAt: row.expires_at ?? undefined,
      createdAt: row.created_at,
    };
  }

  delete(sessionId: string): void {
    this.db.query(`DELETE FROM sessions WHERE session_id = ?`).run(sessionId);
  }

  close(): void {
    this.db.close();
  }
}

/** Resolves the instance access token for a session to a tokenProvider. */
export class SessionTokenProvider {
  constructor(
    private readonly store: SessionStore,
    private readonly getSessionId: () => string | undefined,
  ) {}

  async token(): Promise<string | null> {
    const sessionId = this.getSessionId();
    if (!sessionId) return null;
    const session = this.store.get(sessionId);
    return session?.accessToken ?? null;
  }
}
