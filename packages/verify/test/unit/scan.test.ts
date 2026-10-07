import { describe, expect, test } from 'bun:test'
import { scanOpcodes } from '../../src/static'

// trailing CBOR metadata stub: 3 bytes + 2-byte length (3)
const META = 'a16400' + '0003'

describe('bytecode scan (D17)', () => {
  test('finds a real DELEGATECALL in code', () => {
    expect(scanOpcodes(`0x5f5f5f5f5f5ff400${META}`)).toEqual(['DELEGATECALL@6'])
  })
  test('ignores 0xf4 inside PUSH data', () => {
    expect(scanOpcodes(`0x61f4f400${META}`)).toEqual([])
  })
  test('ignores the constant-data region after the final INVALID', () => {
    const data = 'f2'.repeat(32)
    expect(scanOpcodes(`0x5f00fe${data}${META}`)).toEqual([])
  })
  test('code after an INVALID that is not a data region is still scanned', () => {
    expect(scanOpcodes(`0x00fe5f5ff200${META}`)).toEqual(['CALLCODE@4'])
  })
})
