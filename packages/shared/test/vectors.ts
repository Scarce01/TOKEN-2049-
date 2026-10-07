/** Shared with contracts/test/Vectors.t.sol. Changing one side without the other fails both suites. */
export const VECTORS = {
  intentDigest: '0x943e2e15c64f94742a5478f409efff84e6cf6caee1c67e72a7a91df5c3a1d6ba',
  txHash: '0xd387d1d55bfb32860505351058d13d443189c3c1eeea3bdde57c3184bacf7f9b',
  wfNameTrap: '0x31356534333232623363',
  officerDigest: '0xb8c1010e2f6b74fff9c31057bb100a9e5d0a52de2c62f3db41eb0d90725e7e22',
  cancelDigest: '0x44f78c1aae7f6842b468e73c387ed9daa8f2ec8837ab9f96cb7154396c6ba852',
  p256KeyId: '0xee546e97c83a08bbccc01a0644d599ccd2a7c2e0',
  decoyLeaf: '0xdc1df0a47fdb3d4d6b4ef5f1aa160c9d4a772c7e48e582e11ae3a728589a0d03',
} as const
