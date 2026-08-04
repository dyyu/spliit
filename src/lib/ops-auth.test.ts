/**
 * This module only ever runs on the server, and jsdom does not provide
 * TextDecoder.
 *
 * @jest-environment node
 */
import { getOpsPassword, isOpsAuthorized } from './ops-auth'

/** Encodes credentials the way a browser does: UTF-8 bytes, then base64. */
const basic = (username: string, password: string) =>
  `Basic ${Buffer.from(`${username}:${password}`, 'utf8').toString('base64')}`

describe('isOpsAuthorized', () => {
  const password = 'correct-horse'

  it('accepts the configured password', () => {
    expect(isOpsAuthorized(basic('ops', password), password)).toBe(true)
  })

  it('ignores the username', () => {
    expect(isOpsAuthorized(basic('', password), password)).toBe(true)
    expect(isOpsAuthorized(basic('anyone', password), password)).toBe(true)
  })

  it('accepts a password containing colons', () => {
    const colons = 'a:b:c'
    expect(isOpsAuthorized(basic('ops', colons), colons)).toBe(true)
  })

  it('accepts a non-ASCII password', () => {
    const unicode = 'pässwörd-日本'
    expect(isOpsAuthorized(basic('ops', unicode), unicode)).toBe(true)
  })

  it('rejects the wrong password', () => {
    expect(isOpsAuthorized(basic('ops', 'wrong'), password)).toBe(false)
  })

  it('rejects a password that is a prefix of the correct one', () => {
    expect(isOpsAuthorized(basic('ops', 'correct'), password)).toBe(false)
  })

  it('rejects a missing header', () => {
    expect(isOpsAuthorized(null, password)).toBe(false)
    expect(isOpsAuthorized(undefined, password)).toBe(false)
    expect(isOpsAuthorized('', password)).toBe(false)
  })

  it('rejects a non-Basic scheme', () => {
    expect(
      isOpsAuthorized(`Bearer ${basic('ops', password).slice(6)}`, password),
    ).toBe(false)
  })

  it('rejects malformed base64', () => {
    expect(isOpsAuthorized('Basic not-valid-base64!!', password)).toBe(false)
  })

  it('rejects credentials with no colon separator', () => {
    expect(
      isOpsAuthorized(
        `Basic ${Buffer.from(password, 'utf8').toString('base64')}`,
        password,
      ),
    ).toBe(false)
  })

  it('rejects when no password is configured', () => {
    expect(isOpsAuthorized(basic('ops', ''), '')).toBe(false)
  })
})

describe('getOpsPassword', () => {
  const original = process.env.OPS_PASSWORD

  afterEach(() => {
    if (original === undefined) delete process.env.OPS_PASSWORD
    else process.env.OPS_PASSWORD = original
  })

  it('returns undefined when unset', () => {
    delete process.env.OPS_PASSWORD
    expect(getOpsPassword()).toBeUndefined()
  })

  it('treats blank and whitespace-only values as unset', () => {
    process.env.OPS_PASSWORD = ''
    expect(getOpsPassword()).toBeUndefined()
    process.env.OPS_PASSWORD = '   '
    expect(getOpsPassword()).toBeUndefined()
  })

  it('returns a configured password', () => {
    process.env.OPS_PASSWORD = 'secret'
    expect(getOpsPassword()).toBe('secret')
  })
})
