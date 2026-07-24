import { z } from 'zod';
import type {
  Exercise,
  PlanExercise,
  PlanWorkout,
  TrainingCatalog,
  TrainingCatalogCache,
  TrainingCatalogPlan,
} from '../types';

const tierSchema = z.enum(['starter', 'silver', 'gold', 'elite']);
const goalSchema = z.enum(['fat_loss', 'muscle', 'strength']);

export const exerciseSchema: z.ZodType<Exercise> = z
  .object({
    id: z.string().trim().min(1).max(120),
    name: z.string().trim().min(1).max(200),
    muscleGroup: z.string().trim().min(1).max(100),
    secondaryMuscles: z.array(z.string().trim().min(1).max(100)).max(20),
    equipment: z.string().max(100).nullable(),
    level: z.string().max(50).nullable(),
    category: z.string().max(50).nullable(),
    instructions: z.array(z.string().trim().min(1).max(1000)).max(50),
    imageUrls: z.array(z.string().url().max(2000)).max(10),
  })
  .strict();

export const planExerciseSchema: z.ZodType<PlanExercise> = z
  .object({
    id: z.string().trim().min(1).max(120),
    exerciseId: z.string().trim().min(1).max(120),
    exerciseName: z.string().trim().min(1).max(200),
    sets: z.number().int().min(1).max(20),
    repRange: z.string().trim().min(1).max(40),
    restSec: z.number().int().min(0).max(1800),
  })
  .strict();

export const planWorkoutSchema: z.ZodType<PlanWorkout> = z
  .object({
    id: z.string().trim().min(1).max(120),
    planId: z.string().trim().min(1).max(120),
    week: z.number().int().min(1).max(52),
    day: z.number().int().min(1).max(7),
    name: z.string().trim().min(1).max(200),
    exercises: z.array(planExerciseSchema).max(60),
  })
  .strict();

export const trainingCatalogPlanSchema: z.ZodType<TrainingCatalogPlan> = z
  .object({
    id: z.string().trim().min(1).max(120),
    name: z.string().trim().min(1).max(200),
    tierRequired: tierSchema,
    goalType: goalSchema,
    weeks: z.number().int().min(1).max(52),
    daysPerWeek: z.number().int().min(1).max(7),
    description: z.string().max(4000),
    isBranded: z.boolean(),
    isAvailable: z.boolean(),
    workouts: z.array(planWorkoutSchema).max(60),
  })
  .strict()
  .superRefine((plan, ctx) => {
    if (!plan.isAvailable && plan.workouts.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['workouts'],
        message: 'locked plans must not expose workout structure',
      });
    }
    for (let index = 0; index < plan.workouts.length; index += 1) {
      if (plan.workouts[index]?.planId !== plan.id) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['workouts', index, 'planId'],
          message: 'workout planId must match its parent plan',
        });
      }
    }
  });

export const trainingCatalogSchema: z.ZodType<TrainingCatalog> = z
  .object({
    revision: z.string().regex(/^[a-f0-9]{64}$/),
    generatedAt: z.string().datetime(),
    plans: z.array(trainingCatalogPlanSchema).max(500),
    exercises: z.array(exerciseSchema).max(5000),
  })
  .strict();

export const trainingCatalogCacheSchema: z.ZodType<TrainingCatalogCache> = z
  .object({
    catalog: trainingCatalogSchema,
    fetchedAt: z.string().datetime(),
  })
  .strict();
