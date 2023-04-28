import { Telegraf } from "telegraf";
import { env } from "~/env.mjs";
import { prisma } from "~/server/db";

const bot = new Telegraf(env.TELEGRAM_TOKEN);

bot.start((ctx) => ctx.reply("Welcome"));

const main = async () => {
  const users = await prisma.user.findMany();
  console.log(users);
};

console.log("Bot started");

void main();
