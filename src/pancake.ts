import { Currency, CurrencyAmount, Token, TradeType, Native } from '@pancakeswap/sdk';
import {Pool, SmartRouter, V2Pool, V3Pool} from '@pancakeswap/smart-router';
const { parsePool } = SmartRouter.Transformer
import {redisService} from "./services/redis.service";
import {edgeQueries} from "./utils/edgePoolQueries";
import {ChainId} from "@pancakeswap/chains";
import {Address} from "viem";
import {Protocol} from "./utils/edgeQueries.util";
import {bscClient, viemProviders} from "./services/rpc.service";

export const CHAIN_ID = 56;              // BNB Smart Chain

const POOL_CACHE_SEC  = 20;             // 20 sec

export const quoteProvider = SmartRouter.createQuoteProvider({
    onChainProvider: viemProviders
});

export async function getCandidatePoolsHandler(chainId: ChainId, addressA: Address, addressB: Address, protocols: Protocol[], type: string) {
    const pools =
        type === 'light'
            ? await edgeQueries.fetchAllCandidatePoolsLite(addressA, addressB, chainId, protocols)
            : await edgeQueries.fetchAllCandidatePools(addressA, addressB, chainId, protocols)

    return {
        data: pools,
        lastUpdated: Number(Date.now()),
    }
}

export async function getCandidatePools(currencyA: Token, currencyB: Token): Promise<Pool[]> {
    // 주소 순서를 고정(A–B vs B–A 문제 방지)
    const [addr0, addr1] = [currencyA.address.toLowerCase(), currencyB.address.toLowerCase()].sort();
    const cacheKey = `pools:${CHAIN_ID}:${addr0}:${addr1}`;

    /* Redis 조회 */
    const cached = await redisService.get(cacheKey);
    if (cached) {
        // JSON → V2Pool | V3Pool 배열 역직렬화
        const rawPools = JSON.parse(cached) as Array<V2Pool | V3Pool>;
        return rawPools;
    }

    const body = JSON.stringify(await getCandidatePoolsHandler(CHAIN_ID, currencyA.address, currencyB.address, ['v2', 'v3'], 'light'));
    const { data } = JSON.parse(body) as { data: Array<V2Pool | V3Pool> };

    /* Redis 저장 (TTL: 60 초) */
    await redisService.set(cacheKey, JSON.stringify(data), POOL_CACHE_SEC);

    return data;
}

/* -----------------------------------------------------------
 *  ❖  createStaticPoolProvider  활용
 * ----------------------------------------------------------- */
export async function quoteExactIn(
    tokenIn: Token,
    tokenOut: Token,
    amountRaw: bigint
) {
    const cacheKey = `gas_price:${CHAIN_ID}`;
    const cached = await redisService.get(cacheKey);
    let gasPrice
    if (cached) {
        gasPrice = BigInt(cached)
    } else {
        gasPrice = await bscClient.getGasPrice()
        await redisService.set(cacheKey, String(gasPrice), 3)
    }

    const amountIn = CurrencyAmount.fromRawAmount(tokenIn, amountRaw);
    const candidatePools = await getCandidatePools(tokenIn, tokenOut);
    const pools = candidatePools.map((pool) => parsePool(CHAIN_ID, pool as any))

    const trade = await SmartRouter.getBestTrade(
        amountIn,
        tokenOut,
        TradeType.EXACT_INPUT,
        {
            gasPriceWei: BigInt(gasPrice),
            poolProvider: SmartRouter.createStaticPoolProvider(pools),
            quoteProvider,
            maxHops: 2,
            maxSplits: 2
        }
    );

    return trade;
}
