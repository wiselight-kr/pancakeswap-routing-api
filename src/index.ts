import * as express from 'express'
import {CurrencyAmount, TradeType, ERC20Token} from '@pancakeswap/sdk'
import { V4Router } from '@pancakeswap/smart-router'
import { createPublicClient, http, isAddress } from 'viem'
import { bsc } from 'viem/chains'
import { abi } from './erc20'
import dotenv from 'dotenv'

dotenv.config()

const BSC_RPC_URL = process.env.BSC_RPC_URL || 'https://bsc-dataseed1.binance.org'

const erc20Cache = new Map<string, ERC20Token>()

const client = createPublicClient({
    chain: bsc,
    transport: http(BSC_RPC_URL),
    batch: {
        multicall: {
            batchSize: 1024 * 200,
        },
    },
})

const app = express.default();

interface RequestParams {
    tokenInAddress: string;
    tokenInChainId: number;
    tokenOutAddress: string;
    tokenOutChainId: number;
    amount: bigint;
    type: string;
}

async function getERC20(chainId: number, tokenContractAddress: string): Promise<ERC20Token | null> {
    if (!isAddress(tokenContractAddress)) {
        return null
    }

    const cacheKey = `${chainId}:${tokenContractAddress.toLowerCase()}`

    // If it's in the cache, return it
    if (erc20Cache.has(cacheKey)) {
        return erc20Cache.get(cacheKey) || null
    }

    const [decimals, name, symbol] = await Promise.all([
        client.readContract({
            address: tokenContractAddress,
            abi,
            functionName: 'decimals',
        }),
        client.readContract({
            address: tokenContractAddress,
            abi,
            functionName: 'name',
        }),
        client.readContract({
            address: tokenContractAddress,
            abi,
            functionName: 'symbol',
        }),
    ])

    const token = new ERC20Token(
        Number(chainId),
        tokenContractAddress,
        Number(decimals),
        String(symbol),
        String(name),
    )

    // Save the result in the cache before returning it
    erc20Cache.set(cacheKey, token)
    return token
}
app.get(
    '/quote',
    async (req: express.Request<{}, {}, {}, RequestParams>, res: express.Response) => {
        try {
            const {
                tokenInAddress,
                tokenInChainId,
                tokenOutAddress,
                tokenOutChainId,
                amount: amountRaw,
                type,
            } = req.query

            // Validate addresses
            if (!isAddress(tokenInAddress)) {
                return res.status(400).json({ error: 'Invalid tokenInAddress' })
            }
            if (!isAddress(tokenOutAddress)) {
                return res.status(400).json({ error: 'Invalid tokenOutAddress' })
            }

            // Fetch token info
            const currencyIn = await getERC20(tokenInChainId, tokenInAddress)
            const currencyOut = await getERC20(tokenOutChainId, tokenOutAddress)

            if (!currencyIn) {
                return res.status(400).json({ error: 'Could not fetch tokenIn contract details' })
            }
            if (!currencyOut) {
                return res.status(400).json({ error: 'Could not fetch tokenOut contract details' })
            }

            // amountRaw must be present and parseable
            if (!amountRaw) {
                return res.status(400).json({ error: 'Missing amount parameter' })
            }

            // Prepare the input amount
            const amount = CurrencyAmount.fromRawAmount(currencyIn, BigInt(amountRaw.toString()))

            // Gather candidate pools (example: v3 pools)
            const v3Pools = await V4Router.getV3CandidatePools({
                clientProvider: () => client,
                currencyA: currencyIn,
                currencyB: currencyOut,
            })
            const pools = [...v3Pools]

            // Attempt to find best trade
            const swapRoute = await V4Router.getBestTrade(
                amount,
                currencyOut,
                TradeType.EXACT_INPUT,
                {
                    gasPriceWei: () => client.getGasPrice(),
                    candidatePools: pools,
                }
            )

            if (!swapRoute) {
                // No route found for the swap
                return res.json({})
            }

            // On success, return the result
            const result = {
                amount: amount.quotient.toString(),
                amountDecimals: amount.toExact(),
                quote: swapRoute.outputAmount.quotient.toString(),
                quoteDecimals: swapRoute.outputAmount.toExact(),
                type, // Possibly echo the swap type or other info from the query
            }
            res.json(result)

        } catch (error: any) {
            // If anything went wrong, return a REST error response
            console.error(error)
            res.status(500).json({ error: error.message || 'Unknown error occurred' })
        }
    }
)

app.listen(3000, () => {
    console.log('PancakeSwap Routing API listening on port 3000!');
});