import * as express from 'express'
import {
    CurrencyAmount,
    TradeType,
    ERC20Token
} from '@pancakeswap/sdk'
import { SmartRouter } from '@pancakeswap/smart-router'
import { createPublicClient, http, isAddress } from 'viem'
import { bsc } from 'viem/chains'
import { abi } from './erc20'
import dotenv from 'dotenv'
import { GraphQLClient } from 'graphql-request'

dotenv.config()

const BSC_RPC_URL = process.env.BSC_RPC_URL || 'https://bsc-dataseed1.binance.org'

/* ---------- NEW: in-memory caches ---------- */
const erc20Cache = new Map<string, ERC20Token>()
const poolCache = new Map<
    string,
    { pools: (Omit<SmartRouter.SubgraphV2Pool, "tvlUSD"> | Omit<SmartRouter.SubgraphV3Pool, "tvlUSD">)[]; cachedAt: number }
>()
const POOL_CACHE_TTL_MS = 15 * 60 * 1000 // 15 min
/* ------------------------------------------- */

const client = createPublicClient({
    chain: bsc,
    transport: http(BSC_RPC_URL),
    batch: {
        multicall: { batchSize: 1024 * 200 },
    },
})

const v3SubgraphClient = new GraphQLClient(
    'https://api.thegraph.com/subgraphs/name/pancakeswap/exchange-v3-bsc'
)
const v2SubgraphClient = new GraphQLClient(
    'https://proxy-worker-api.pancakeswap.com/bsc-exchange'
)

const quoteProvider = SmartRouter.createQuoteProvider({
    onChainProvider: () => client,
})

const app = express.default()

interface RequestParams {
    tokenInAddress: string
    tokenInChainId: number
    tokenOutAddress: string
    tokenOutChainId: number
    amount: bigint
    type: string
}

/* ---------- helper to build symmetric cache key ---------- */
function pairKey(a: ERC20Token, b: ERC20Token) {
    // sort by chainId → address to ensure A/B == B/A
    return [a, b]
        .sort((x, y) =>
            x.chainId === y.chainId
                ? x.address.localeCompare(y.address)
                : x.chainId - y.chainId
        )
        .map((t) => `${t.chainId}:${t.address.toLowerCase()}`)
        .join('|')
}
/* --------------------------------------------------------- */

async function getERC20(
    chainId: number,
    tokenContractAddress: string
): Promise<ERC20Token | null> {
    if (!isAddress(tokenContractAddress)) return null

    const cacheKey = `${chainId}:${tokenContractAddress.toLowerCase()}`
    const cached = erc20Cache.get(cacheKey)
    if (cached) return cached

    const [decimals, name, symbol] = await Promise.all([
        client.readContract({ address: tokenContractAddress, abi, functionName: 'decimals' }),
        client.readContract({ address: tokenContractAddress, abi, functionName: 'name' }),
        client.readContract({ address: tokenContractAddress, abi, functionName: 'symbol' }),
    ])

    const token = new ERC20Token(
        Number(chainId),
        tokenContractAddress,
        Number(decimals),
        String(symbol),
        String(name)
    )
    erc20Cache.set(cacheKey, token)
    return token
}

/* ---------- NEW: fetch-or-cache candidate pools ---------- */
async function getCandidatePools(
    currencyIn: ERC20Token,
    currencyOut: ERC20Token
): Promise<(Omit<SmartRouter.SubgraphV2Pool, "tvlUSD"> | Omit<SmartRouter.SubgraphV3Pool, "tvlUSD">)[]> {
    const key = pairKey(currencyIn, currencyOut)
    const now = Date.now()

    // 1) serve from cache if fresh
    const cached = poolCache.get(key)
    if (cached && now - cached.cachedAt < POOL_CACHE_TTL_MS) {
        return cached.pools
    }

    // 2) otherwise refresh from subgraphs
    const [v2Pools, v3Pools] = await Promise.all([
        SmartRouter.getV2CandidatePools({
            onChainProvider: () => client,
            v2SubgraphProvider: () => v2SubgraphClient,
            v3SubgraphProvider: () => v3SubgraphClient,
            currencyA: currencyIn,
            currencyB: currencyOut,
        }),
        SmartRouter.getV3CandidatePools({
            onChainProvider: () => client,
            subgraphProvider: () => v3SubgraphClient,
            currencyA: currencyIn,
            currencyB: currencyOut,
            subgraphFallback: false,
        }),
    ])

    const pools = [...v2Pools, ...v3Pools]

    // store fresh copy
    poolCache.set(key, { pools, cachedAt: now })
    return pools
}
/* --------------------------------------------------------- */

app.get(
    '/quote',
    async (
        req: express.Request<{}, {}, {}, RequestParams>,
        res: express.Response
    ) => {
        try {
            const {
                tokenInAddress,
                tokenInChainId,
                tokenOutAddress,
                tokenOutChainId,
                amount: amountRaw,
                type,
            } = req.query

            if (!isAddress(tokenInAddress))
                return res.status(400).json({ error: 'Invalid tokenInAddress' })
            if (!isAddress(tokenOutAddress))
                return res.status(400).json({ error: 'Invalid tokenOutAddress' })
            if (!amountRaw)
                return res.status(400).json({ error: 'Missing amount parameter' })

            const currencyIn = await getERC20(tokenInChainId, tokenInAddress)
            const currencyOut = await getERC20(tokenOutChainId, tokenOutAddress)
            if (!currencyIn)
                return res
                    .status(400)
                    .json({ error: 'Could not fetch tokenIn contract details' })
            if (!currencyOut)
                return res
                    .status(400)
                    .json({ error: 'Could not fetch tokenOut contract details' })

            const amount = CurrencyAmount.fromRawAmount(
                currencyIn,
                BigInt(amountRaw.toString())
            )

            /* ---------- use the cached pool fetcher ---------- */
            const pools = await getCandidatePools(currencyIn, currencyOut)

            const swapRoute = await SmartRouter.getBestTrade(
                amount,
                currencyOut,
                TradeType.EXACT_INPUT,
                {
                    gasPriceWei: () => client.getGasPrice(),
                    maxHops: 2,
                    maxSplits: 2,
                    poolProvider: SmartRouter.createStaticPoolProvider(pools),
                    quoteProvider,
                    quoterOptimization: true,
                }
            )

            if (!swapRoute) {
                return res.json({}) // no route
            }

            res.json({
                amount: amount.quotient.toString(),
                amountDecimals: amount.toExact(),
                quote: swapRoute.outputAmount.quotient.toString(),
                quoteDecimals: swapRoute.outputAmount.toExact(),
                type,
            })
        } catch (error: any) {
            console.error(error)
            res.status(500).json({ error: error.message || 'Unknown error occurred' })
        }
    }
)

app.listen(3000, () => {
    console.log('PancakeSwap Routing API listening on port 3000!')
})
