import { database } from "./database";

export interface Session { userId: string }

export async function authenticate(token: string): Promise<Session | null> {
  const user = await database.findByToken(token);
  return user ? { userId: user.id } : null;
}

export function requireSession(session: Session | null): Session {
  if (!session) throw new Error("Unauthorized");
  return session;
}
