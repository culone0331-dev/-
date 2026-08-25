import { getDb } from "../../../db";
import { garageSaves } from "../../../db/schema";
import { eq } from "drizzle-orm";

const codePattern = /^[A-HJ-NP-Z2-9]{10}$/;
const tiers = new Set(["初級", "中級", "上級"]);
const carIds = new Set(["stella", "nova", "sora", "littleBanger"]);

function normalize(value: unknown) {
  return typeof value === "string" ? value.trim().toUpperCase() : "";
}

export async function GET(request: Request) {
  const code = normalize(new URL(request.url).searchParams.get("code"));
  if (!codePattern.test(code)) return Response.json({ error: "コードは10文字で入力してください。" }, { status: 400 });
  const [save] = await getDb().select().from(garageSaves).where(eq(garageSaves.code, code)).limit(1);
  if (!save) return Response.json({ error: "この引き継ぎコードは見つかりません。" }, { status: 404 });
  return Response.json({ save });
}

export async function POST(request: Request) {
  const body = await request.json() as { code?: unknown; carTier?: unknown; parts?: unknown; tickets?: unknown; challengeTier?: unknown };
  const code = normalize(body.code);
  if (!codePattern.test(code) || !carIds.has(String(body.carTier)) || !tiers.has(String(body.challengeTier))) {
    return Response.json({ error: "保存内容が正しくありません。" }, { status: 400 });
  }
  const parts = body.parts as Record<string, unknown>;
  if (!parts || !["tires", "wing", "ride", "engine"].every((key) => parts[key] === 0 || parts[key] === 1)) {
    return Response.json({ error: "改造内容が正しくありません。" }, { status: 400 });
  }
  await getDb().insert(garageSaves).values({ code, carTier: String(body.carTier), partsJson: JSON.stringify(parts), tickets: Math.max(0, Number(body.tickets) || 0), challengeTier: String(body.challengeTier) }).onConflictDoUpdate({ target: garageSaves.code, set: { carTier: String(body.carTier), partsJson: JSON.stringify(parts), tickets: Math.max(0, Number(body.tickets) || 0), challengeTier: String(body.challengeTier), updatedAt: new Date().toISOString() } });
  return Response.json({ code }, { status: 201 });
}
