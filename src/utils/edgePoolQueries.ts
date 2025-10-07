import { ChainId, getChainName } from '@pancakeswap/chains'
import { hooksList } from '@pancakeswap/infinity-sdk'
import {
  getPoolAddress,
  InfinityBinPool,
  InfinityClPool,
  InfinityPoolWithTvl,
  InfinityRouter,
  Pool,
  PoolType,
  SmartRouter,
  StablePoolWithTvl,
  V2PoolWithTvl,
  V3Pool,
  V3PoolWithTvl,
  WithTvl,
} from '@pancakeswap/smart-router'

import {
  RemotePoolBase,
  RemotePoolBIN,
  RemotePoolCL,
} from '@pancakeswap/smart-router/dist/evm/infinity-router/queries/remotePool.type'
import { v2Clients, v3Clients } from './graphql'
import { Address } from 'viem/accounts'
import { APIChain, getProvider, mockCurrency, Protocol } from './edgeQueries.util'

async function fetchInfinityPoolsFromApi(addressA: Address, addressB: Address, chainId: ChainId) {
  const chain = getChainName(chainId)
  const url = `${process.env.NEXT_PUBLIC_EXPLORE_API_ENDPOINT}/cached/pools/candidates/infinity/${chain}/${addressA}/${addressB}`
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Error fetching infinity pools: ${response.statusText}`)
  }
  const data = (await response.json()) as (RemotePoolCL | RemotePoolBIN)[]
  return data
}
const fetchInfinityPools = async (addressA: Address, addressB: Address, chainId: ChainId) => {
  const pools = await fetchInfinityPoolsFromApi(addressA, addressB, chainId)
  const localPools = pools
    .map((pool) => {
      return InfinityRouter.toLocalInfinityPool(pool, chainId as keyof typeof hooksList)
    })
    .filter((x) => x) as InfinityPoolWithTvl[]
  const [currencyA, currencyB] = await Promise.all([mockCurrency(addressA, chainId), mockCurrency(addressB, chainId)])
  const filtered = SmartRouter.infinityPoolTvlSelector(currencyA, currencyB, localPools)
  const clPools = filtered.filter((pool) => pool.type === PoolType.InfinityCL) as InfinityClPool[]
  const binPools = filtered.filter((pool) => pool.type === PoolType.InfinityBIN) as InfinityBinPool[]

  const [poolWithTicks, poolWithBins] = await Promise.all([
    InfinityRouter.fillClPoolsWithTicks({
      pools: clPools,
      clientProvider: getProvider(),
    }),
    InfinityRouter.fillPoolsWithBins({
      pools: binPools,
      clientProvider: getProvider(),
    }),
  ])
  return [...poolWithTicks, ...poolWithBins]
}

/*
const fetchInfinityPoolsLight = async (addressA: Address, addressB: Address, chainId: ChainId) => {
  const [currencyA, currencyB] = await Promise.all([mockCurrency(addressA, chainId), mockCurrency(addressB, chainId)])
  const chain = getChainName(chainId)
  const tvlMap = await poolTvlMap(['infinityBin', 'infinityCl'], chain as APIChain)
  const ref: InfinityRouter.InfinityPoolTvlReferenceMap = {}
  Object.entries(tvlMap).forEach(([id, tvlUSD]) => {
    ref[id] = {
      tvlUSD: BigInt(Math.floor(Number(tvlUSD))),
      tvlRef: id,
    }
  })

  const pools = await InfinityRouter.getInfinityCandidatePoolsLite({
    currencyA,
    currencyB,
    clientProvider: getProvider(),
    tvlRefMap: ref,
  })
  return pools
}
 */

const fetchV2Pools = async (addressA: Address, addressB: Address, chainId: ChainId) => {
  const [currencyA, currencyB] = await Promise.all([mockCurrency(addressA, chainId), mockCurrency(addressB, chainId)])

  const pools = await SmartRouter.getV2CandidatePools({
    currencyA,
    currencyB,
    onChainProvider: getProvider(),
    v3SubgraphProvider: () => v3Clients
  })
  return pools
}

const fetchV3Pools = async (addressA: Address, addressB: Address, chainId: ChainId) => {
  const [currencyA, currencyB] = await Promise.all([mockCurrency(addressA, chainId), mockCurrency(addressB, chainId)])

  const pools = await InfinityRouter.getV3CandidatePools({
    currencyA,
    currencyB,
    clientProvider: getProvider(),
  })

  return pools
}

const fetchV3PoolsWithoutTicks = async (addressA: Address, addressB: Address, chainId: ChainId) => {
  const [currencyA, currencyB] = await Promise.all([mockCurrency(addressA, chainId), mockCurrency(addressB, chainId)])
  const client = getProvider()
  const blockNumber = await client({ chainId })?.getBlockNumber()

  const pools = await SmartRouter.getV3CandidatePools({
    currencyA,
    currencyB,
    subgraphProvider: ({ chainId }) => (chainId ? v3Clients : undefined),
    onChainProvider: getProvider(),
    blockNumber,
  })

  return pools as V3Pool[]
}

const fetchSSPool = async (addressA: Address, addressB: Address, chainId: ChainId) => {
  const [currencyA, currencyB] = await Promise.all([mockCurrency(addressA, chainId), mockCurrency(addressB, chainId)])
  const client = getProvider()
  const blockNumber = await client({ chainId })?.getBlockNumber()

  const pools = await SmartRouter.getStableCandidatePools({
    currencyA,
    currencyB,
    onChainProvider: getProvider(),
    blockNumber,
  })

  const chain = getChainName(chainId)
  const tvlMap = await poolTvlMap(['stable'], chain as APIChain)
  return fillTvl(tvlMap, pools) as StablePoolWithTvl[]
}

const querySingleType = async (chainId: ChainId, protocol: Protocol, addressA: Address, addressB: Address) => {
  switch (protocol) {
    case 'v2': {
      return fetchV2Pools(addressA, addressB, chainId)
    }
    case 'stable': {
      return fetchSSPool(addressA, addressB, chainId)
    }
    case 'v3': {
      return fetchV3Pools(addressA, addressB, chainId)
    }
    case 'infinityBin':
    case 'infinityCl': {
      return fetchInfinityPools(addressA, addressB, chainId)
    }
    default:
      throw new Error('invalid pool')
  }
}

const querySingleTypeLite = async (chainId: ChainId, protocol: Protocol, addressA: Address, addressB: Address) => {
  switch (protocol) {
    case 'v2': {
      return fetchV2Pools(addressA, addressB, chainId)
    }
    case 'stable': {
      return fetchSSPool(addressA, addressB, chainId)
    }
    case 'v3': {
      return fetchV3PoolsWithoutTicks(addressA, addressB, chainId)
    }
    /*
    case 'infinityBin':
    case 'infinityCl': {
      return fetchInfinityPoolsLight(addressA, addressB, chainId)
    }
     */
    default:
      throw new Error('invalid pool')
  }
}
const fetchAllCandidatePools = async (
  addressA: Address,
  addressB: Address,
  chainId: ChainId,
  protocols: Protocol[],
) => {
  const queries = await Promise.all(
    protocols
      .filter((x) => x !== 'infinityBin') // For infinity pools fetch together
      .map((protocol) => querySingleType(chainId, protocol as Protocol, addressA, addressB)),
  )
  const pools = queries.flat() as (InfinityPoolWithTvl | V2PoolWithTvl | V3PoolWithTvl | StablePoolWithTvl)[]
  return pools.map((pool) => {
    return SmartRouter.Transformer.serializePool(pool as Pool)
  })
}

const fetchAllCandidatePoolsLite = async (
  addressA: Address,
  addressB: Address,
  chainId: ChainId,
  protocols: Protocol[],
) => {
  const queries = await Promise.all(
    protocols
      .filter((x) => x !== 'infinityBin')
      .map((protocol) => querySingleTypeLite(chainId, protocol as Protocol, addressA, addressB)),
  )
  const pools = queries.flat() as (InfinityPoolWithTvl | V2PoolWithTvl | V3Pool | V3PoolWithTvl | StablePoolWithTvl)[]
  return pools.map((pool) => {
    return SmartRouter.Transformer.serializePool(pool as Pool)
  })
}

function fillTvl(tvlMap: Record<`0x${string}`, string>, pools: Pool[]) {
  return pools.map((pool) => {
    const id = getPoolAddress(pool)
    const tvlUSD: string = tvlMap[id as `0x${string}`] || '0'
    const bigIntTvlUSD = BigInt(Math.floor(Number(tvlUSD)))
    if ('tvlUSD' in pool) {
      return { ...pool, tvlUSD: bigIntTvlUSD }
    }
    return pool as Pool & WithTvl
  })
}

export const poolTvlMap = async (protocols: Protocol[], chain: APIChain) => {
  try {
    const remotePools = await fetchAllPools({
      baseUrl: 'https://explorer.pancakeswap.com/api/cached/pools/tvl-refs',
      protocols,
      chains: [chain],
      orderBy: 'tvlUSD',
      pageSize: 1000,
    })
    const tvlMap: Record<`0x${string}`, string> = {}
    for (const pool of remotePools) {
      const tvlUSD = pool.tvlUSD
      const id = pool.id
      tvlMap[id] = tvlUSD
    }
    return tvlMap
  } catch (ex) {
    return {}
  }
}

type PaginatedResponse = {
  startCursor?: string
  endCursor?: string
  hasNextPage: boolean
  hasPrevPage: boolean
  rows: RemotePoolBase[]
}

type Token = {
  id: string
  symbol: string
  name: string
  decimals: number
}

type FetchAllPoolsParams = {
  baseUrl: string
  orderBy?: 'tvlUSD' | 'volumeUSD24h' | 'apr24h'
  protocols: Array<'v2' | 'v3' | 'infinityBin' | 'infinityCl' | 'stable'>
  chains: Array<
    'bsc' | 'bsc-testnet' | 'ethereum' | 'base' | 'opbnb' | 'zksync' | 'polygon-zkevm' | 'linea' | 'arbitrum'
  >
  pools?: string[]
  tokens?: string[]
  pageSize?: number
  maxPages?: number // Optional safety limit for maximum pages to fetch
}

/**
 * Fetches all data from a paginated API endpoint
 * @param params Configuration parameters for the fetch operation
 * @returns Promise resolving to an array of all pools
 */
async function fetchAllPools({
  baseUrl,
  orderBy = 'tvlUSD',
  protocols,
  chains,
  pools = [],
  tokens = [],
  pageSize = 100,
  maxPages = Infinity,
}: FetchAllPoolsParams): Promise<RemotePoolBase[]> {
  const allResults: RemotePoolBase[] = []
  let cursor: string | null = null
  let hasNextPage = true
  let pageCount = 0

  // Construct the base URL params
  const buildUrlParams = (after?: string) => {
    const params = new URLSearchParams()

    // Add required parameters
    params.append('orderBy', orderBy)

    // Add protocols
    protocols.forEach((protocol) => {
      params.append('protocols', protocol)
    })

    // Add chains if tokens are not specified
    chains.forEach((chain) => {
      params.append('chains', chain)
    })

    // Add pools if specified
    pools.forEach((pool) => {
      params.append('pools', pool)
    })

    // Add tokens if specified
    tokens.forEach((token) => {
      params.append('tokens', token)
    })

    // Add pagination parameters
    if (after) {
      params.append('after', after)
    }

    // Add page size
    params.append('limit', pageSize.toString())

    return params.toString()
  }

  while (hasNextPage && pageCount < maxPages) {
    const url = `${baseUrl}?${buildUrlParams(cursor || undefined)}`
    console.log(url)

    try {
      // eslint-disable-next-line no-await-in-loop
      const response = await fetch(url, {
        headers: {
          'x-api-key': process.env.EXPLORER_API_KEY || '',
          'Content-Type': 'application/json',
        },
      })

      if (!response.ok) {
        throw new Error(`API request failed with status ${response.status}`)
      }

      // eslint-disable-next-line no-await-in-loop
      const data: PaginatedResponse = await response.json()

      // Add the current page of results
      allResults.push(...data.rows)

      // Update for next iteration
      hasNextPage = data.hasNextPage
      cursor = data.endCursor || null
      pageCount++
    } catch (error) {
      console.error('Error fetching data:', error)
      throw error
    }
  }

  if (pageCount >= maxPages && hasNextPage) {
    console.warn(`Reached maximum page limit of ${maxPages}. Some data may not have been fetched.`)
  }

  return allResults
}

export const edgeQueries = {
  fetchAllCandidatePools,
  fetchAllCandidatePoolsLite,
  fetchAllPools,
  fetchV2Pools,
  fetchV3Pools,
  fetchV3PoolsWithoutTicks,
  fetchSSPool,
  fetchInfinityPools,
  //fetchInfinityPoolsLight,
  querySingleType,
  querySingleTypeLite,
  poolTvlMap,
}
