import { type Context, type NarrowedContext } from "telegraf";
import {
  type Message,
  type Update,
  type User,
} from "telegraf/typings/core/types/typegram";
import config from "~/bot/config";
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
  user?: User,
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
  const new_chat_members = ctx.message.new_chat_members as User[] | undefined;
  if (new_chat_members) {
    if (new_chat_members.find((i) => i.username === config.bot_username)) {
      void ctx.reply(`Hello, I'm a task manager bot. I can help you to delegate your tasks.
      
To get started, please adjust group settings:
1. Add me to the group as an administrator.
2. Enable "Chat History For New Members" to "visible" in group settings.

Now, we're ready to go.
      
You can create a task by mentioning me in any message. For example, you can write "Hey @${config.bot_username}, please do something".
Also, you can assign a task to another user by mentioning him. For example, you can write "Hey @user, please do something".

You can summon me in any chat - I will list all active tasks, so you can send them to other chat, or to take actions (edit, complete, etc).

If you have any questions, please contact @${config.author_username}

`);
    }

    await Promise.all(
      new_chat_members
        .filter((i) => !i.is_bot)
        .map((user) => ensureUserInChat(ctx, user)),
    );
  }
};
