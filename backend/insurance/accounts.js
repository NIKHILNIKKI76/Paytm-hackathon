import { randomBytes, randomUUID, scrypt, timingSafeEqual, createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { promisify } from 'node:util';
import { InputError } from './inputs.js';

const derive = promisify(scrypt);
const sessionAge = 7 * 24 * 3600;
const hash = (token) => createHash('sha256').update(token).digest('hex');

export function createAccounts(path) {
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, salt TEXT NOT NULL, password TEXT NOT NULL,
      context TEXT NOT NULL DEFAULT '{}'
    );
    CREATE TABLE IF NOT EXISTS insurance_sessions (
      token TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id), expires INTEGER NOT NULL
    );
  `);
  const account = (email) => db.prepare('SELECT id, email, salt, password FROM accounts WHERE email = ?').get(email);
  const cookieToken = (request) => request.headers.cookie?.match(/(?:^|;\s*)insurance_session=([a-f0-9]{64})(?:;|$)/)?.[1];
  const secure = (request) => request.socket?.encrypted ? '; Secure' : '';
  const attempts = new Map();

  return {
    async authenticate(input, signup, response, request) {
      const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
      const { password } = input;
      if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
          typeof password !== 'string' || password.length < 10 || password.length > 128) {
        throw new InputError('Enter a valid email and a password of 10 to 128 characters.');
      }
      const now = Date.now();
      for (const [key, attempt] of attempts) if (attempt.until <= now) attempts.delete(key);
      const address = request.socket?.remoteAddress ?? 'local';
      const attempt = attempts.get(address) ?? { count: 0, until: now + 60_000 };
      if (attempt.count >= 12) throw new InputError('Too many attempts. Try again in a minute.', 429);
      attempt.count += 1;
      attempts.set(address, attempt);
      let user = account(email);
      const salt = user?.salt ?? randomBytes(16).toString('hex');
      const key = await derive(password, salt, 64);
      if (signup) {
        const id = randomUUID();
        const inserted = db.prepare('INSERT OR IGNORE INTO accounts (id,email,salt,password) VALUES (?,?,?,?)')
          .run(id, email, salt, key.toString('hex'));
        if (!inserted.changes) throw new InputError('An account already exists for this email. Sign in instead.', 409);
        user = { id, email };
      } else if (!user || !timingSafeEqual(key, Buffer.from(user.password, 'hex'))) {
        throw new InputError('Email or password is incorrect.', 401);
      }

      const token = randomBytes(32).toString('hex');
      const old = cookieToken(request);
      if (old) db.prepare('DELETE FROM insurance_sessions WHERE token = ?').run(hash(old));
      db.prepare('DELETE FROM insurance_sessions WHERE expires <= ?').run(Date.now());
      db.prepare('INSERT INTO insurance_sessions VALUES (?,?,?)').run(hash(token), user.id, Date.now() + sessionAge * 1000);
      response.setHeader('Set-Cookie', `insurance_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${sessionAge}${secure(request)}`);
      return { id: user.id, email: user.email };
    },

    identify(request) {
      const token = cookieToken(request);
      if (!token) return null;
      return db.prepare(`SELECT accounts.id, accounts.email FROM accounts
        JOIN insurance_sessions ON accounts.id = insurance_sessions.account_id
        WHERE insurance_sessions.token = ? AND insurance_sessions.expires > ?`).get(hash(token), Date.now()) ?? null;
    },

    signOut(request, response) {
      const token = cookieToken(request);
      if (token) db.prepare('DELETE FROM insurance_sessions WHERE token = ?').run(hash(token));
      response.setHeader('Set-Cookie', `insurance_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure(request)}`);
    },

    read(id) {
      return JSON.parse(db.prepare('SELECT context FROM accounts WHERE id = ?').get(id).context);
    },

    update(id, change) {
      db.exec('BEGIN IMMEDIATE');
      try {
        const current = this.read(id);
        change(current);
        db.prepare('UPDATE accounts SET context = ? WHERE id = ?').run(JSON.stringify(current), id);
        db.exec('COMMIT');
        return current;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },

    close() { db.close(); },
  };
}
