import { z } from "zod";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";

export const tasksRouter = createTRPCRouter({
  listChats: publicProcedure.input(z.object({ user_id: z.number() })).query(({ input, ctx }) => {
    return ctx.prisma.chat.findMany({
      where: {
        AND: {
          users: {
            some: {
              telegramId: input.user_id,
            },
          },
          tasks: {
            some: {
              done: false,
            },
          },
        },
      },
      include: {
        tasks: {
          where: { done: false },
          include: {
            assignee: true,
          },
        },
      },
    });
  }),
});
