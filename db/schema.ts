import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const garageSaves = sqliteTable("garage_saves", {
  code: text("code").primaryKey(),
  carTier: text("car_tier").notNull(),
  partsJson: text("parts_json").notNull(),
  tickets: integer("tickets").notNull().default(0),
  challengeTier: text("challenge_tier").notNull(),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});
