import dotenv from 'dotenv'
dotenv.config()

import { ChainId } from '@pancakeswap/chains'
import { createPublicClient, fallback, http, PublicClient } from 'viem'
import {bsc} from "viem/chains";
import {OnChainProvider} from "@pancakeswap/smart-router";

export const SERVER_NODES = {
    [ChainId.BSC]: [
        process.env.BSC_RPC_URL || '',
    ].filter(Boolean),
}

export const bscClient = createPublicClient({
    chain: bsc,
    transport: http(process.env.BSC_RPC_URL ?? 'https://bsc-dataseed1.binance.org'),
})

export const viemProviders: OnChainProvider = ({ chainId }: { chainId?: ChainId }) => {
    return bscClient
}

export const viemServerClients = [bsc.id].reduce((prev, cur) => {
    return {
        ...prev,
        [bsc.id]: createPublicClient({
            chain: bsc,
            transport: http(process.env.BSC_RPC_URL ?? 'https://bsc-dataseed1.binance.org'),
            batch: {
                multicall: {
                    batchSize: 1024 * 200,
                    wait: 16,
                },
            },
            pollingInterval: 6_000,
        }),
    }
}, {} as Record<ChainId, PublicClient>)

export const getViemClients = ({ chainId }: { chainId: ChainId }) => {
    return viemServerClients[chainId]
}
