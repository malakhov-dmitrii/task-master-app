/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */

import axios from "axios";
import { prisma } from "~/server/db";
import dotenv from "dotenv";
import {
  type MessageEntity,
  type InlineQueryResult,
  type Message,
  type User,
} from "telegraf/typings/core/types/typegram";
import config from "~/bot/config";
import { type Chat, type Task } from "@prisma/client";
import {
  ensureUserExists,
  ensureUserInChat,
  handleBotAdded,
  updateAgenda,
} from "~/bot/lib/utils";
import { bot, token } from "~/bot/lib/bot";
// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
dotenv.config();

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

export const saveServiceMessage = async (message: Message) => {
  // @ts-expect-error typing is wrong
  const taskId = message.text?.match(/Task ID: (\w+)/)?.[1];
  if (!taskId) return;
  await prisma.task
    .update({
      where: { id: taskId },
      data: {
        serviceMessages: {
          push: message.message_id,
        },
      },
    })
    .catch(handleErr);
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
  await prisma.task
    .update({
      where: { id: task.id },
      data: {
        serviceMessages: {
          set: [],
        },
      },
    })
    .catch(handleErr);
  console.log("Messages clean up");
};

bot.on("message", async (ctx) => {
  // @ts-expect-error typing is wrong
  const text = (ctx.message.text ?? "") as string;
  // @ts-expect-error typing is wrong
  const replyToText = ctx.message?.reply_to_message?.text as string | undefined;

  console.log({ text, replyToText });

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
  const threadReplyMatch =
    // @ts-expect-error typing is wrong
    ctx.message.reply_to_message?.message_id === replyToMessageId;

  const res = await axios
    .post(`https://api.telegram.org/bot${token}/messages.messagesSlice`, {
      count: 1,
      // offset_id: messageId,
      offset_id_offset: messageId,
    })
    .catch((e) => {
      // console.log(e.response.data);
    });

  console.log(res);

  // ctx.

  let assigneeMention = null as User | null;
  const botMentioned = text.includes(config.bot_username);

  // @ts-expect-error this field may be available
  const entities = ctx.message?.entities as MessageEntity[] | undefined;
  const textMention = entities?.find(
    (entity) => entity.type === "text_mention",
    // @ts-expect-error user may be present or not
  )?.user as User;

  if (textMention) {
    assigneeMention = {
      first_name: textMention.first_name ?? "",
      last_name: textMention.last_name ?? "",
      username: textMention.username ?? "",
      id: textMention.id,
      is_bot: textMention.is_bot ?? false,
    };
  } else if (!botMentioned) {
    const mentions =
      entities
        ?.filter((entity) => entity.type === "mention")
        ?.map((entity) =>
          text.slice(entity.offset, entity.offset + entity.length),
        ) ?? [];

    /**
     * Handle mention of a user in a task when only username is available
     */
    const m = mentions[0];
    if (mentions.length > 1) {
      void ctx.reply(
        `Only one assignee per task is allowed, the first one will be used: ${
          m ?? "n/a"
        }`,
      );
    }

    const userFromMentions = m
      ? await prisma.user.findFirst({
          where: {
            username: m.slice(1),
          },
        })
      : null;

    if (!userFromMentions && m) {
      console.log("User not found", m, botMentioned);

      await ctx.reply(
        `User ${m} should write something in this chat to be able to be mentioned in taskss`,
      );
      return;
    }

    if (userFromMentions) {
      assigneeMention = {
        first_name: `${userFromMentions?.fullName ?? ""}`,
        username: `${userFromMentions?.username ?? ""}`,
        id: userFromMentions?.telegramId ?? -1,
        is_bot: false,
      };
    }
    /** */
  }

  if (botMentioned || assigneeMention) {
    if (!threadReplyMatch) {
      void ctx.reply(
        "To update the task, please reply to the original task message",
      );
      return;
    }

    await ensureUserInChat(ctx, assigneeMention);

    let task = await prisma.task.findFirst({
      where: {
        AND: {
          chat: {
            telegramId: ctx.chat.id,
          },
          messageId: messageId,
        },
      },
    });
    const editMode = !!task;

    if (task) {
      task = await prisma.task
        .update({
          where: {
            id: task.id,
          },
          data: {
            // TODO: We need to be careful about dates and timezones
            text: `${task?.text ?? ""}

<b>----- ${new Date(ctx.message.date * 1000).toLocaleString()} -----</b>
${text}`,
          },
        })
        .catch(handleErr);
    } else {
      task = await prisma.task.create({
        data: {
          text: replyToText
            ? `${replyToText}
          
${text}`
            : text,
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

    if (!task) {
      console.log("Task not found");
      return;
    }

    const reply = await ctx.reply(
      `<b>Task ${editMode ? "updated" : "created"}</b>
<b>Assignee:</b> ${assigneeName ?? "not assigned"}
<b>Receive confirmed:</b> ${task?.confirmed ? "yes" : "no"}

<b>Task content:</b>
${task?.text ?? ""}

<span class="tg-spoiler">#botignore Task ID: ${task?.id ?? ""}</span>
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
                callback_data: `rsvp:${task?.id ?? ""}`,
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
    await updateAgenda(ctx.chat.id);
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
          .replaceAll("</b>", "") || "No text",
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
    await prisma.task
      .update({
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
      })
      .catch(handleErr);

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
  await updateAgenda(task.chat.telegramId);
});

void bot.launch();
console.log("Bot started");

// Enable graceful stop
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));

const handleErr = (err: Error) => {
  console.error(err);
  return null;
};
