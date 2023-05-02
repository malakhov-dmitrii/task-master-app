/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { type Task } from "@prisma/client";
import { type Context, type NarrowedContext } from "telegraf";
import {
  type Message,
  type Update,
  type User,
} from "telegraf/typings/core/types/typegram";
import config from "~/bot/config";
import { bot } from "~/bot/lib/bot";
import { prisma } from "~/server/db";

const chatUsersCache = new Map<number, User[]>();

/**
 * this method is used to ensure that the user exists in the database
 * - if not, it will be created
 * - if yes, but username is not set
 * NOTE: Username is not set when user is first created from mention
 *
 * @param user
 * @returns
 */
export const ensureUserExists = async (user: User) => {
  const ctxUser = await prisma.user.findUnique({
    where: {
      telegramId: user.id,
    },
    include: {
      chats: true,
    },
  });

  if (!ctxUser) {
    return await prisma.user.create({
      data: {
        fullName: `${user.first_name} ${user.last_name ?? ""}`.trim(),
        telegramId: user.id,
        username: user.username ?? "",
      },
      include: {
        chats: true,
      },
    });
  }

  if (!ctxUser.username && user.username) {
    return await prisma.user.update({
      where: {
        id: ctxUser.id,
      },
      data: {
        username: user.username,
      },
      include: {
        chats: true,
      },
    });
  }

  return ctxUser;
};

export const ensureUserInChat = async (
  ctx: NarrowedContext<Context<Update>, Update.MessageUpdate<Message>>,
  user?: User | null,
) => {
  const userObject = {
    id: user?.id ?? ctx.from.id,
    first_name: user ? user?.first_name : ctx.from.first_name,
    last_name: user ? user?.last_name : ctx.from.last_name,
    username: user ? user?.username : ctx.from.username,
    is_bot: false,
  };

  if (chatUsersCache.has(ctx.chat.id)) {
    const users = chatUsersCache.get(ctx.chat.id);
    if (users?.find((user) => user.id === userObject.id)) {
      console.log("Cache: User already in chat");
      return;
    }
  }

  let chat = await prisma.chat.findUnique({
    where: {
      telegramId: ctx.chat.id,
    },
  });

  const ctxUser = await ensureUserExists(userObject);

  if (!chat) {
    chat = await prisma.chat.create({
      data: {
        telegramId: ctx.chat.id,
        // @ts-expect-error typing is wrong
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        name: ctx.chat.title ?? "",
        users: {
          connect: { telegramId: userObject.id },
        },
      },
    });
    console.log("Chat created, user connected");
  } else if (!chat.usersIds.includes(ctxUser.id)) {
    await prisma.chat.update({
      where: { id: chat.id },
      data: { users: { connect: { telegramId: userObject.id } } },
    });
    console.log("User connected to chat");
  }

  chatUsersCache.set(ctx.chat.id, [
    ...(chatUsersCache.get(ctx.chat.id) ?? []),
    ctx.from,
  ]);
  console.log("Cache: User added to chat");
};

export const handleBotAdded = async (
  ctx: NarrowedContext<Context<Update>, Update.MessageUpdate<Message>>,
) => {
  // @ts-expect-error typing is wrong
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const group_chat_created = ctx.message.group_chat_created;

  // @ts-expect-error typing is wrong
  const new_chat_members = ctx.message.new_chat_members as User[] | undefined;
  if (new_chat_members || group_chat_created) {
    if (
      new_chat_members?.find((i) => i.username === config.bot_username) ||
      group_chat_created
    ) {
      //       const greeting = `Hello, I'm a task manager bot. I can help you to delegate your tasks.

      // To get started, please adjust group settings:
      // 1. Add me to the group as an administrator.
      // 2. Enable "Chat History For New Members" to "visible" in group settings.

      // Now, we're ready to go.

      // You can create a task by mentioning me in any message.
      // For example, you can write "Hey @${config.bot_username}, please do something".

      // Also, you can assign a task to another user by mentioning him.
      // For example, you can write "Hey @user, please do something".

      // You can summon me in any chat - I will list all active tasks, so you can send them to other chat, or to take actions (edit, complete, etc):
      // Just start typing "@${config.bot_username}" and select a task from the list, or press "Manage tasks" button on top.

      // If you have any questions, please contact @${config.author_username}

      // `;

      const greeting = `<b>Setup:</b>
- Create a group chat and add me to it as an administrator.
- Enable "Chat History For New Members" to "visible" in group settings.

<b>How to use:</b>
- Mention me in any message to create a task.
- Mention another user to assign a task to him.
- Start typing @${config.bot_username} in any chat to list all active tasks.
- Refer to agenda to see all tasks active today.
- Press "Manage tasks" button on top for advanced actions.

For help, write to @${config.author_username}`;

      void ctx.reply(greeting, { parse_mode: "HTML" });
      await prisma.chat.create({
        data: {
          telegramId: ctx.chat.id,
          // @ts-expect-error okay
          name: ctx.chat.title ?? "",
        },
      });

      void updateAgenda(ctx.chat.id);
    }

    await Promise.all(
      new_chat_members
        ?.filter((i) => !i.is_bot)
        .map((user) => ensureUserInChat(ctx, user)) ?? [],
    );
  }
};

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
${
  tasks.length
    ? tasks
        // not done first
        .sort((a, b) => (a.done ? 1 : -1) - (b.done ? 1 : -1))
        .map((task, index) => {
          const text = `${index + 1}. ${task.text}`;
          return task.done ? `<s>${text}</s>` : text;
        })
        .join("\n")
    : "No tasks yet"
}
  `;
};

export const updateAgenda = async (chatId: number) => {
  // const prevAgenda = await prisma.agenda.findUnique({ where: { chatId } });
  const chat = await prisma.chat.findUnique({
    where: { telegramId: chatId },
    include: {
      tasks: {
        // If task is marked as done today - it should be present in agenda
        // If task is marked as done before today - it should not be present in agenda, code here:
        where: {
          OR: [
            {
              updatedAt: {
                gte: new Date(new Date().setHours(0, 0, 0, 0)),
              },
            },
            {
              AND: {
                updatedAt: {
                  lt: new Date(new Date().setHours(0, 0, 0, 0)),
                },
                done: false,
              },
            },
          ],
        },
      },
      agenda: true,
    },
  });

  if (!chat) return;
  const agenda = getAgendaTemplate(chat.tasks);

  if (chat.agenda) {
    await bot.telegram
      .editMessageText(
        chat.telegramId,
        chat.agenda.messageId,
        undefined,
        agenda,
        {
          parse_mode: "HTML",
        },
      )
      .catch((e) => {
        console.log(e);
      });

    await prisma.agenda
      .update({
        where: {
          id: chat.agenda.id,
        },
        data: {
          text: agenda,
        },
      })
      .catch((e) => {
        console.log(e);
      });
  } else {
    const agendaMessage = await bot.telegram.sendMessage(
      chat.telegramId,
      agenda,
      {
        disable_notification: true,
        parse_mode: "HTML",
      },
    );

    await bot.telegram.pinChatMessage(
      chat.telegramId,
      agendaMessage.message_id,
      {
        disable_notification: true,
      },
    );

    await prisma.agenda.create({
      data: {
        messageId: agendaMessage.message_id,
        text: agenda,
        chat: {
          connect: {
            id: chat.id,
          },
        },
      },
    });
  }
};
