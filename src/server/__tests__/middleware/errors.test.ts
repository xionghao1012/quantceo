import { describe, it, expect } from 'vitest'
import { AppError, NotFoundError, ValidationError, UnauthorizedError, ForbiddenError, RateLimitError } from '../../middleware/errors.js'

describe('AppError', () => {
  it('has correct name', () => {
    const err = new AppError('test')
    expect(err.name).toBe('AppError')
  })
  it('has message', () => {
    const err = new AppError('something went wrong')
    expect(err.message).toBe('something went wrong')
  })
  it('defaults statusCode to 500', () => {
    const err = new AppError('test')
    expect(err.statusCode).toBe(500)
  })
  it('accepts custom statusCode', () => {
    const err = new AppError('test', 400)
    expect(err.statusCode).toBe(400)
  })
  it('accepts code', () => {
    const err = new AppError('test', 400, 'BAD_REQUEST')
    expect(err.code).toBe('BAD_REQUEST')
  })
  it('is instance of Error', () => {
    const err = new AppError('test')
    expect(err instanceof Error).toBe(true)
  })
})

describe('NotFoundError', () => {
  it('statusCode is 404', () => {
    const err = new NotFoundError()
    expect(err.statusCode).toBe(404)
  })
  it('code is NOT_FOUND', () => {
    const err = new NotFoundError()
    expect(err.code).toBe('NOT_FOUND')
  })
  it('default message', () => {
    const err = new NotFoundError()
    expect(err.message).toBe('资源不存在')
  })
  it('custom message', () => {
    const err = new NotFoundError('用户不存在')
    expect(err.message).toBe('用户不存在')
  })
})

describe('ValidationError', () => {
  it('statusCode is 400', () => {
    const err = new ValidationError('invalid input')
    expect(err.statusCode).toBe(400)
  })
  it('code is VALIDATION_ERROR', () => {
    const err = new ValidationError('test')
    expect(err.code).toBe('VALIDATION_ERROR')
  })
  it('passes message', () => {
    const err = new ValidationError('字段必填')
    expect(err.message).toBe('字段必填')
  })
})

describe('UnauthorizedError', () => {
  it('statusCode is 401', () => {
    const err = new UnauthorizedError()
    expect(err.statusCode).toBe(401)
  })
  it('code is UNAUTHORIZED', () => {
    const err = new UnauthorizedError()
    expect(err.code).toBe('UNAUTHORIZED')
  })
  it('default message', () => {
    const err = new UnauthorizedError()
    expect(err.message).toBe('未登录')
  })
})

describe('ForbiddenError', () => {
  it('statusCode is 403', () => {
    const err = new ForbiddenError()
    expect(err.statusCode).toBe(403)
  })
  it('code is FORBIDDEN', () => {
    const err = new ForbiddenError()
    expect(err.code).toBe('FORBIDDEN')
  })
  it('default message', () => {
    const err = new ForbiddenError()
    expect(err.message).toBe('无权限')
  })
})

describe('RateLimitError', () => {
  it('statusCode is 429', () => {
    const err = new RateLimitError()
    expect(err.statusCode).toBe(429)
  })
  it('code is RATE_LIMIT', () => {
    const err = new RateLimitError()
    expect(err.code).toBe('RATE_LIMIT')
  })
  it('default message', () => {
    const err = new RateLimitError()
    expect(err.message).toBe('请求过于频繁')
  })
})
