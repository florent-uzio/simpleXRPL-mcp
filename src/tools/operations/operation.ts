import type { z } from 'zod'
import type { NativeOrder } from '../../backend/adapter'

/**
 * One Native operation's input fields and their mapping to the operation, shared by its standalone tool and its
 * Batch entry, so both take the same input in the same units.
 */
type OperationBuilder<Shape extends z.ZodRawShape, Operation extends NativeOrder['operation']> = {
  shape: Shape
  operation: (input: z.infer<z.ZodObject<Shape>>) => Operation
}

export const defineOperation = <Shape extends z.ZodRawShape, Operation extends NativeOrder['operation']>(
  builder: OperationBuilder<Shape, Operation>,
) => builder
