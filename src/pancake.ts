import dotenv from 'dotenv'
dotenv.config()

import { createPublicClient, http } from 'viem';
import { bsc } from 'viem/chains';                 // BSC 체인 정보
import { Currency, CurrencyAmount, Token, TradeType, Native } from '@pancakeswap/sdk';
import {Pool, SmartRouter, V2Pool, V3Pool} from '@pancakeswap/smart-router';
const { parsePool } = SmartRouter.Transformer
import type { PublicClient } from 'viem';
import { request } from 'undici';
import { abi } from './erc20'
import {redisService} from "./services/redis.service";
import {checksumAddress} from "./utils/checksumAddress";

export const CHAIN_ID = 56;              // BNB Smart Chain

const TOKEN_CACHE_SEC = 60 * 60 * 12;   // 12 h
const POOL_CACHE_SEC  = 15 * 60;             // 15 min

/* ---------- 1. 온‑체인 / 서브그래프 프로바이더 ---------- */
export const rpc: PublicClient = createPublicClient({
    chain: bsc,
    transport: http(process.env.BSC_RPC_URL ?? 'https://bsc-dataseed1.binance.org')
});

export const quoteProvider = SmartRouter.createQuoteProvider({
    onChainProvider: () => rpc
});

export async function resolveCurrency(address: string): Promise<Currency> {
    if (address === '0x0000000000000000000000000000000000000000') {
        return Native.onChain(CHAIN_ID);
    }

    const cacheKey = `token:${CHAIN_ID}:${address.toLowerCase()}`;
    const cached = await redisService.get(cacheKey);
    if (cached) {
        // Redis에는 JSON 문자열이 저장되어 있으므로 역직렬화 후 Token 인스턴스로 복원
        const j = JSON.parse(cached) as { decimals: number; symbol: string; name: string };
        return new Token(CHAIN_ID, checksumAddress(address as `0x${string}`), j.decimals, j.symbol, j.name);
    }

    /* ── 원래 로직 실행 ──────────────────────────────────────────── */
    const { bscTokens } = await import('@pancakeswap/tokens');
    const found = Object.values(bscTokens).find(
        (t: Token) => t.address.toLowerCase() === address.toLowerCase()
    );
    if (found) {
        // 토큰 리스트에 이미 존재 → Redis에도 넣고 바로 반환
        await redisService.set(cacheKey, JSON.stringify({
            decimals: found.decimals,
            symbol: found.symbol,
            name: found.name ?? found.symbol    // 일부 토큰은 name 필드가 없을 수 있음
        }), TOKEN_CACHE_SEC);
        return found;
    }

    /* on-chain metadata 조회 */
    const [decimals, name, symbol] = await Promise.all([
        rpc.readContract({ abi, address: address as `0x${string}`, functionName: 'decimals' }),
        rpc.readContract({ abi, address: address as `0x${string}`, functionName: 'name' }),
        rpc.readContract({ abi, address: address as `0x${string}`, functionName: 'symbol' })
    ]);

    const token = new Token(CHAIN_ID, checksumAddress(address as `0x${string}`), Number(decimals), String(symbol), String(name));

    /* Redis 저장 */
    await redisService.set(cacheKey, JSON.stringify({ decimals, symbol, name }), TOKEN_CACHE_SEC);

    return token;
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

    /* ── 원래 REST 호출 로직 ─────────────────────────────────────── */
    const qs = new URLSearchParams({
        addressA: currencyA.address,
        addressB: currencyB.address,
        chainId: String(CHAIN_ID),
        protocol: 'v2,v3',
        type: 'light'
    }).toString();

    const url = `https://pancakeswap.finance/api/pools/candidates?${qs}`;
    const { body } = await request(url, { method: 'GET', headers: { accept: 'application/json' } });
    const { data } = (await body.json()) as { data: Array<V2Pool | V3Pool> };

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
        gasPrice = await rpc.getGasPrice()
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
