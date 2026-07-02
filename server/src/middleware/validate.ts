import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';

/**
 * Creates an Express middleware that validates req.body against a Zod schema.
 * On failure, returns 400 with field-level error details.
 */
export function validate(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      req.body = schema.parse(req.body);
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        const details = err.errors.map((e) => ({
          field: e.path.join('.'),
          message: e.message,
        }));
        const summary = details
          .map((detail) => detail.field ? `${detail.field}: ${detail.message}` : detail.message)
          .join('; ');
        res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: summary ? `Request validation failed: ${summary}` : 'Request validation failed',
            details,
          },
        });
        return;
      }
      next(err);
    }
  };
}
