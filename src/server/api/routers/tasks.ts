import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { updateAgenda } from "~/bot/lib/utils";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";

export const tasksRouter = createTRPCRouter({
  listChats: publicProcedure
    .input(z.object({ user_id: z.number() }))
    .query(({ input, ctx }) => {
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
  deleteTask: publicProcedure
    .input(z.object({ task_id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const task = await ctx.prisma.task.findUnique({
        where: {
          id: input.task_id,
        },
        include: {
          chat: true,
        },
      });
      if (!task) throw new TRPCError({ code: "NOT_FOUND" });

      await ctx.prisma.task.delete({
        where: {
          id: input.task_id,
        },
      });
      await updateAgenda(task?.chat.telegramId);
    }),
  markAsDone: publicProcedure
    .input(z.object({ task_id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const task = await ctx.prisma.task.update({
        where: {
          id: input.task_id,
        },
        data: {
          done: true,
        },
        include: {
          chat: true,
        },
      });

      await updateAgenda(task?.chat.telegramId);
    }),
});
