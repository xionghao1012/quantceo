export class AppError extends Error {
  constructor(
    message: string,
    public statusCode: number = 500,
    public code?: string,
  ) {
    super(message)
    this.name = 'AppError'
  }
}

export class NotFoundError extends AppError {
  constructor(msg = '资源不存在') { super(msg, 404, 'NOT_FOUND') }
}

export class ValidationError extends AppError {
  constructor(msg: string) { super(msg, 400, 'VALIDATION_ERROR') }
}

export class UnauthorizedError extends AppError {
  constructor(msg = '未登录') { super(msg, 401, 'UNAUTHORIZED') }
}

export class ForbiddenError extends AppError {
  constructor(msg = '无权限') { super(msg, 403, 'FORBIDDEN') }
}

export class RateLimitError extends AppError {
  constructor(msg = '请求过于频繁') { super(msg, 429, 'RATE_LIMIT') }
}
