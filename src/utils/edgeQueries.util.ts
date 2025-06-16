import { ChainId } from '@pancakeswap/chains'
import { INFINITY_SUPPORTED_CHAINS } from '@pancakeswap/infinity-sdk'
import { OnChainProvider, SmartRouter } from '@pancakeswap/smart-router'
import { Currency } from '@pancakeswap/swap-sdk-core'
import { getTokenByAddress } from '@pancakeswap/tokens'
import { memoizeAsync } from './memoize'
import qs from 'qs'
import { checksumAddress } from './checksumAddress'
import { type Address, erc20Abi } from 'viem'
import {getViemClients} from "../services/rpc.service";
import {redisService} from "../services/redis.service";

export type Protocol = 'v2' | 'stable' | 'v3' | 'infinityCl' | 'infinityBin'

export const ALLOWED_PROTOCOLS = ['v2', 'stable', 'v3', 'infinityCl', 'infinityBin']
const TOKEN_CACHE_SEC = 60 * 60 * 12;   // 12 h

// This is only for get pools, because get pools dont require symbol and decimals
export const mockCurrency = memoizeAsync(
  async (address: Address, chainId: ChainId) => {
    const token = getTokenByAddress(chainId, address)
    if (token) {
      return SmartRouter.Transformer.parseCurrency(chainId, {
        address,
        decimals: token.decimals,
        symbol: token.symbol,
      })
    }
    const onChainToken = await getToken(address, chainId)
    if (onChainToken) {
      return onChainToken
    }

    return SmartRouter.Transformer.parseCurrency(chainId, {
      address,
      decimals: 18,
      symbol: '',
    })
  },
  {
    resolver: (address: `0x${string}`, chainId: number) => {
      return `${address.toLowerCase()}-${chainId}`
    },
  },
)

export async function getToken(address: Address, chainId: ChainId): Promise<Currency | undefined> {
  const cacheKey = `token:${chainId}:${address.toLowerCase()}`;
  const cached = await redisService.get(cacheKey);
  if (cached) {
    // Redis에는 JSON 문자열이 저장되어 있으므로 역직렬화 후 Token 인스턴스로 복원
    const j = JSON.parse(cached) as { decimals: number; symbol: string };
    return SmartRouter.Transformer.parseCurrency(chainId, {
      address: safeGetAddress(address) as Address,
      decimals: j.decimals,
      symbol: j.symbol,
    })
  }

  const client = getViemClients({ chainId })
  const checksumAddress = safeGetAddress(address)
  if (!checksumAddress) {
    return undefined
  }
  const result = await client.multicall({
    contracts: [
      { address: checksumAddress, abi: erc20Abi, functionName: 'decimals' },
      { address: checksumAddress, abi: erc20Abi, functionName: 'symbol' },
    ],
  })
  const [decimals, symbol] = result.map((x) => x.result) as [number, string, string]
  const currency =  SmartRouter.Transformer.parseCurrency(chainId, {
    address: checksumAddress,
    decimals,
    symbol,
  })
  await redisService.set(cacheKey, JSON.stringify({ decimals, symbol }), TOKEN_CACHE_SEC);
  return currency
}

export const getProvider = () => {
  return getViemClients as OnChainProvider
}

const MAX_CACHE_SECONDS = 10

export function parseCandidatesQuery(raw: string) {
  if (!raw) {
    throw new Error('Invalid query')
  }
  const queryParsed = qs.parse(raw)
  const addressA = checksumAddress(queryParsed.addressA as Address)
  const addressB = checksumAddress(queryParsed.addressB as Address)
  const protocols = ((queryParsed.protocol as string) || '').split(',') as Protocol[]
  const chainId = Number.parseInt(queryParsed.chainId as string)
  const typeParam = (queryParsed.type as string) || 'full'
  const type = typeParam === 'light' ? 'light' : 'full'
  const includeInfinity = protocols.includes('infinityBin') || protocols.includes('infinityCl')
  if (!INFINITY_SUPPORTED_CHAINS.includes(chainId) && includeInfinity) {
    throw new Error('Invalid chainId')
  }
  for (const protocol of protocols) {
    if (ALLOWED_PROTOCOLS.indexOf(protocol) === -1) {
      throw new Error('Invalid protocol')
    }
  }
  return {
    addressA,
    addressB,
    protocols,
    chainId,
    type,
  }
}

export function parseTvQuery(raw: string) {
  if (!raw) {
    throw new Error('Invalid query')
  }

  const queryParsed = qs.parse(raw)
  const protocols = ((queryParsed.protocol as string) || '').split(',') as Protocol[]
  const chainId = Number.parseInt(queryParsed.chainId as string)

  const allowedProtocols = ['infinityBin', 'infinityCl']

  if (!INFINITY_SUPPORTED_CHAINS.includes(chainId)) {
    throw new Error('Invalid chainId')
  }

  for (const protocol of protocols) {
    if (!allowedProtocols.includes(protocol)) {
      throw new Error('Invalid protocol')
    }
  }

  return {
    protocols,
    chainId,
  }
}

export function getEdgeChainName(chainId: ChainId): APIChain {
  switch (chainId) {
    case ChainId.BSC:
      return 'bsc'
    case ChainId.BSC_TESTNET:
      return 'bsc-testnet'
    case ChainId.ETHEREUM:
      return 'ethereum'
    case ChainId.BASE:
      return 'base'
    case ChainId.OPBNB:
      return 'opbnb'
    case ChainId.ZKSYNC:
      return 'zksync'
    case ChainId.POLYGON_ZKEVM:
      return 'polygon-zkevm'
    case ChainId.LINEA:
      return 'linea'
    case ChainId.ARBITRUM_ONE:
      return 'arbitrum'
    default:
      throw new Error('Invalid chain id')
  }
}

export type APIChain =
  | 'bsc'
  | 'bsc-testnet'
  | 'ethereum'
  | 'base'
  | 'opbnb'
  | 'zksync'
  | 'polygon-zkevm'
  | 'linea'
  | 'arbitrum'

export const safeGetAddress = (address: Address) => {
  try {
    return checksumAddress(address)
  } catch (error) {
    return undefined
  }
}
