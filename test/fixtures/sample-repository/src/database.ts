export const database = {
  findByToken(token: string): Promise<{ id: string } | null> {
    return Promise.resolve(token ? { id: "user-1" } : null);
  }
};
