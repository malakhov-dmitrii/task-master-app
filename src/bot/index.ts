/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */

import { type Context, type NarrowedContext, Telegraf } from "telegraf";
import { prisma } from "~/server/db";
import dotenv from "dotenv";
import {
  type MessageEntity,
  type InlineQueryResult,
  type Message,
  type Update,
  type User,
} from "telegraf/typings/core/types/typegram";
import axios from "axios";
import config from "~/bot/config";
import { type Chat, type Task } from "@prisma/client";
import {
  ensureUserExists,
  ensureUserInChat,
  handleBotAdded,
} from "~/bot/lib/utils";
// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
dotenv.config();

const token = process.env.TELEGRAM_TOKEN!;
const bot = new Telegraf(token);

bot.start((ctx) =>
  ctx.reply("Welcome", {
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: "View tasks",
            web_app: { url: "https://1a73-61-19-77-58.ngrok-free.app" },
          },
        ],
      ],
    },
  }),
);

const getAgendaTemplate = (tasks: Task[]) => {
  return `<b>Agenda for ${new Date().toLocaleDateString()}:</b>
  
Tasks with no ETC or Deadline date: ${
    tasks.filter((task) => !task.deadline).length
  }
Tasks with no assignee: ${tasks.filter((task) => !task.assigneeId).length}
Tasks older than 1 week: ${
    tasks.filter(
      (task) => task.createdAt < new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
    ).length
  }

All active tasks:
${tasks.map((task, index) => `${index + 1}. ${task.text}`).join("\n")}
  `;
};

const updateAgenda = async (chatId: string) => {
  // const prevAgenda = await prisma.agenda.findUnique({ where: { chatId } });

  const tasks = await prisma.task.findMany({
    where: {
      AND: {
        chatId,
        done: false,
      },
    },
  });

  const agenda = getAgendaTemplate(tasks);

  const agendaMessage = await bot.telegram.sendMessage(chatId, agenda, {
    disable_notification: true,
    parse_mode: "HTML",
  });
  await prisma.agenda.create({
    data: {
      messageId: agendaMessage.message_id,
      text: agenda,
      chat: {
        connect: {
          id: chatId,
        },
      },
    },
  });

  // if (prevAgenda) {
  // }

  // await prisma.chat.update({
  //   where: {
  //     telegramId: chatId,
  //   },
  //   data: {
  //     agenda,
  //   },
  // });
};

// void prisma.chat.findMany().then((chats) => {
//   chats.forEach((chat) => {
//     void updateAgenda(chat.id);
//   });
// });

export const saveServiceMessage = async (message: Message) => {
  // @ts-expect-error typing is wrong
  const taskId = message.text?.match(/Task ID: (\w+)/)?.[1];
  if (!taskId) return;
  await prisma.task.update({
    where: { id: taskId },
    data: {
      serviceMessages: {
        push: message.message_id,
      },
    },
  });
};
export const clearServiceMessages = async (
  task: Task & {
    chat: Chat;
  },
) => {
  // const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task) return;
  for await (const id of task.serviceMessages ?? []) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    await bot.telegram.deleteMessage(task.chat.telegramId, id).catch(handleErr);
    console.log("Deleted message", id);
  }
  await prisma.task.update({
    where: { id: task.id },
    data: {
      serviceMessages: {
        set: [],
      },
    },
  });
  console.log("Messages clean up");
};

bot.on("message", async (ctx) => {
  // @ts-expect-error typing is wrong
  const text = (ctx.message.text ?? "") as string;

  await saveServiceMessage(ctx.message);
  if (text.includes("botignore")) {
    console.log("Bot ignored");
    return;
  }
  await handleBotAdded(ctx);
  // @ts-expect-error typing is wrong
  if (ctx.message.group_chat_created || !text.trim()) return;

  await ensureUserInChat(ctx);

  // console.log("Message", ctx.message.message_id, ctx.message.text);

  const replyToMessageId = ctx.message.message_thread_id;
  const messageId = replyToMessageId ?? ctx.message.message_id;

  const assigneeMention = {
    first_name: "",
    last_name: "",
    username: "",
    id: -1,
    is_bot: false,
  };

  // @ts-expect-error this field may be available
  const entities = ctx.message?.entities as MessageEntity[] | undefined;
  const textMention = entities?.find(
    (entity) => entity.type === "text_mention",
    // @ts-expect-error user may be present or not
  )?.user as User;

  if (textMention) {
    assigneeMention.first_name = textMention.first_name ?? "";
    assigneeMention.last_name = textMention.last_name ?? "";
    assigneeMention.username = textMention.username ?? "";
    assigneeMention.id = textMention.id;
  } else {
    const mentions =
      entities
        ?.filter((entity) => entity.type === "mention")
        ?.map((entity) =>
          text.slice(entity.offset, entity.offset + entity.length),
        ) ?? [];

    /**
     * Handle mention of a user in a task when only username is available
     */
    if (mentions.length > 1) {
      const m = mentions[0];
      void ctx.reply(
        `Only one assignee per task is allowed, the first one will be used: ${
          m ?? "n/a"
        }`,
      );
    }

    const userFromMentions = mentions[0]
      ? await prisma.user.findFirst({
          where: {
            username: mentions[0].slice(1),
          },
        })
      : null;

    if (!userFromMentions && mentions[0]) {
      await ctx.reply(
        `User ${mentions[0]} should write something in this chat to be able to be mentioned in taskss`,
      );
      return;
    }

    assigneeMention.first_name = `${userFromMentions?.fullName ?? ""}`;
    assigneeMention.username = `${userFromMentions?.username ?? ""}`;
    assigneeMention.id = userFromMentions?.telegramId ?? -1;
    /** */
  }

  const botMentioned = text.includes(config.bot_username);

  if (botMentioned || assigneeMention) {
    await ensureUserInChat(ctx, assigneeMention);

    let task = await prisma.task.findFirst({
      where: {
        messageId: messageId,
      },
    });
    const editMode = !!task;

    if (task) {
      task = await prisma.task.update({
        where: {
          id: task.id,
        },
        data: {
          // TODO: We need to be careful about dates and timezones
          text: `${task?.text ?? ""}

<b>----- ${new Date(ctx.message.date * 1000).toLocaleString()} -----</b>
${text}`,
        },
      });
    } else {
      task = await prisma.task.create({
        data: {
          text: text,
          messageId,
          ...(assigneeMention && {
            assignee: {
              connect: {
                telegramId: assigneeMention.id,
              },
            },
          }),
          chat: { connect: { telegramId: ctx.chat.id } },
        },
      });
    }

    const assigneeName =
      assigneeMention &&
      `${`${assigneeMention.first_name ?? ""} ${
        assigneeMention.last_name ?? ""
      }`.trim()}`;
    const reply = await ctx.reply(
      `<b>Task ${editMode ? "updated" : "created"}</b>
<b>Assignee:</b> ${assigneeName ?? "not assigned"}
<b>Receive confirmed:</b> no

<b>Task content:</b>
${task.text}

<span class="tg-spoiler">#botignore Task ID: ${task.id}</span>
        `,
      {
        parse_mode: "HTML",
        reply_to_message_id: messageId,
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: "RSVP ✅",
                // this will assign the task to the user who clicked the button
                // and set the confirmed field to true
                // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
                callback_data: `rsvp:${task.id}`,
              },
            ],
          ],
        },
      },
    );
    await prisma.task.update({
      where: {
        id: task.id,
      },
      data: {
        serviceMessages: {
          push: reply.message_id,
        },
      },
    });
  }
});

bot.on("inline_query", async (ctx) => {
  const user = await ensureUserExists(ctx.inlineQuery.from);
  const tasks = await prisma.task.findMany({
    where: {
      AND: {
        chat: { usersIds: { hasSome: [user.id] } },
        done: false,
      },
    },
    include: {
      assignee: true,
      chat: true,
    },
  });

  const results = tasks
    .filter((t) =>
      t.text?.toLowerCase().includes(ctx.inlineQuery.query?.toLowerCase()),
    )
    .map((task) => ({
      type: "article",
      id: task.id,
      title:
        task.text
          ?.replaceAll("\n", " ")
          .replaceAll("<b>", "")
          .replaceAll("</b>", "") ?? "No text",
      description: `Assigned to: ${
        task.assignee?.fullName ?? "not assigned"
      }. Chat: ${task.chat.name}`,
      thumb_url: `https://ui-avatars.com/api/?name=${encodeURIComponent(
        task.assignee?.fullName ?? "not assigned",
      )}&format=jpeg&size=64&background=random&bold=true&color=fff`,
      thumb_height: 64,
      thumb_width: 64,
      input_message_content: {
        message_text: `Actions for <a href="https://t.me/c/${String(
          task.chat.telegramId,
        ).replace("-100", "")}/${task.messageId}">task</a>:
Assigned to: ${task.assignee?.fullName ?? "not assigned"}
Created: ${task.createdAt.toLocaleString()}
----------------

${task.text}

<span class="tg-spoiler">#botignore Task ID: ${task.id}</span>`,
        parse_mode: "HTML",
      },
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: "RSVP ✅",
              callback_data: `rsvp:${task.id}`,
            },
          ],
          [
            {
              text: "Mark as done ✅",
              callback_data: `done:${task.id}`,
            },
            {
              text: "Cancel task ❌",
              callback_data: `cancel:${task.id}`,
            },
          ],
        ],
      },
    })) as InlineQueryResult[];

  void ctx
    .answerInlineQuery(results, {
      cache_time: 30,
      switch_pm_text: "Manage tasks",
      switch_pm_parameter: "manage",
    })
    .catch((err) => {
      console.error(err);
      // void ctx.answerInlineQuery([]);
    });

  // await ctx.answerInlineQuery([])
  // bot.telegram.answerInlineQuery(ctx.inlineQuery.id)
  //   const res = axios.post(`https://api.telegram.org/bot${token}/answerInlineQuery`, {
  //     inline_query_id: ctx.inlineQuery.id,
  //     results,
  //     button: {
  //       text: "Manage tasks",
  //       web_app: {
  //         url: config.web_app_url,
  //       },
  //     },
  //   });
  // console.log((await res).data);
});

bot.on("callback_query", async (ctx) => {
  // console.log("Callback", ctx.callbackQuery);
  // ctx.deleteMessage();

  // @ts-expect-error typing is wrong
  const data = ctx.callbackQuery?.data;
  const [action, taskId] = data?.split(":") ?? [];

  const task = await prisma.task.findUnique({
    where: {
      id: taskId,
    },
    include: {
      chat: true,
    },
  });

  if (!task) {
    void ctx.answerCbQuery("Task not found");
    return;
  }

  const user = await ensureUserExists(ctx.callbackQuery.from);
  if (!user.chats.find((i) => i.telegramId === task.chat.telegramId)) {
    void ctx.answerCbQuery(
      "You are not permitted to perform actions on this task",
    );
    return;
  }

  if (action === "rsvp") {
    await prisma.task.update({
      where: {
        id: taskId,
      },
      data: {
        confirmed: true,
        assignee: {
          connect: {
            id: user.id,
          },
        },
      },
    });

    const text = `${user.fullName} confirmed the receipt of the task`;
    void ctx.answerCbQuery(text);
    void ctx.telegram.sendMessage(task.chat.telegramId, text, {
      reply_to_message_id: task.messageId,
    });
  }
  if (action === "done") {
    await prisma.task.update({
      where: {
        id: taskId,
      },
      data: {
        done: true,
      },
    });

    const text = `Task marked as done`;
    void ctx.answerCbQuery(text).catch(handleErr);
    void ctx.telegram
      .sendMessage(task.chat.telegramId, text, {
        reply_to_message_id: task.messageId,
      })
      .catch(handleErr);
  }
  if (action === "cancel") {
    await prisma.task.delete({
      where: {
        id: taskId,
      },
    });
    const text = "Task deleted";
    void ctx.answerCbQuery(text).catch(handleErr);
    void ctx.telegram
      .sendMessage(task.chat.telegramId, text, {
        reply_to_message_id: task.messageId,
      })
      .catch(handleErr);
  }

  await clearServiceMessages(task);
});

void bot.launch();
console.log("Bot started");

// Enable graceful stop
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));

const handleErr = (err: Error) => console.error(err);
