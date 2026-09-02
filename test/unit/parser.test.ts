import { describe, expect, it } from "vitest";
import { StructuralCodeParser } from "../../src/indexing/parsing/structural-parser";

describe("StructuralCodeParser", () => {
  it("extracts TypeScript symbols, imports, exports, calls, and ranges", async () => {
    const source = `import { db } from "./db";\nexport async function authenticate(token: string) {\n  return db.find(token);\n}\n\nexport class AuthService {\n  login() { return authenticate("x"); }\n}`;
    const parsed = await new StructuralCodeParser().parse("src/auth.ts", "typescript", source);
    expect(parsed.imports).toEqual(["./db"]);
    expect(parsed.exports).toContain("authenticate");
    expect(parsed.symbols.map((symbol) => symbol.name)).toEqual(expect.arrayContaining(["authenticate", "AuthService"]));
    expect(parsed.symbols.find((symbol) => symbol.name === "authenticate")).toMatchObject({ startLine: 2, endLine: 4, exported: true });
    expect(parsed.dependencies).toContainEqual(expect.objectContaining({ sourceName: "authenticate", targetName: "find", relationship: "CALLS" }));
  });

  it("extracts Python functions and classes using indentation", async () => {
    const source = `from app.db import db\n\nclass AuthService:\n    def login(self, token):\n        return db.find(token)\n\ndef public():\n    return True`;
    const parsed = await new StructuralCodeParser().parse("app/auth.py", "python", source);
    expect(parsed.imports).toEqual(["app.db"]);
    expect(parsed.symbols.map((symbol) => symbol.name)).toEqual(["AuthService", "login", "public"]);
    expect(parsed.symbols.find((symbol) => symbol.name === "login")?.parentSymbol).toBe("AuthService");
  });
});
