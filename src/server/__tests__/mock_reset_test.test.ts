import { it, expect, vi, beforeEach } from 'vitest'

const mockFn = vi.fn()

beforeEach(() => {
  console.log('beforeEach START: mockFn.getMockImplementation =', !!mockFn.getMockImplementation())
  vi.resetAllMocks()
  console.log('after resetAllMocks: mockFn.getMockImplementation =', !!mockFn.getMockImplementation())
  mockFn.mockImplementation(() => 'from beforeEach')
  console.log('after setup: mockFn.getMockImplementation =', !!mockFn.getMockImplementation())
})

it('test A', async () => {
  console.log('test A: mockFn() =', mockFn())
  expect(mockFn()).toBe('from beforeEach')
})

it('test B', async () => {
  console.log('test B: mockFn() =', mockFn())
  expect(mockFn()).toBe('from beforeEach')
})
