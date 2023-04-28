import { Telegraf } from "telegraf";
import { prisma } from "~/server/db";
import dotenv from "dotenv";
// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
dotenv.config();

const bot = new Telegraf(process.env.TELEGRAM_TOKEN!);

bot.start((ctx) => ctx.reply("Welcome"));

void bot.launch();
console.log("Bot started");

// Enable graceful stop
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
