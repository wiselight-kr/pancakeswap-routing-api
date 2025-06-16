import express from 'express'
import { CHAIN_ID, quoteExactIn } from './pancake';
import {Token} from "@pancakeswap/sdk";
import {redisService} from "./services/redis.service";
import {getToken} from "./utils/edgeQueries.util";

redisService.connect();

const app = express();
/**
 * GET /quote
 * ?tokenInAddress=0x...&tokenOutAddress=0x...&amount=1000000000000000000&type=exactIn
 */
app.get('/quote', async (req, res) => {
    try {
        const {
            tokenInAddress,
            tokenOutAddress,
            tokenInChainId,
            tokenOutChainId,
            amount,
            type = 'exactIn'
        } = req.query as Record<string, string>;

        /* -------- 파라미터 검증 -------- */
        if (!tokenInAddress || !tokenOutAddress || !amount)
            return res.status(400).json({ error: 'Missing required query params.' });

        if (tokenInChainId !== tokenOutChainId || Number(tokenInChainId) !== CHAIN_ID)
            return res.status(400).json({ error: 'Cross‑chain swap is not supported.' });

        if (!['exactIn'].includes(type))
            return res.status(400).json({ error: `type ${type} not supported` });

        /* -------- 토큰 객체화 -------- */
        const [tokenIn, tokenOut] = await Promise.all([
            getToken(tokenInAddress as `0x${string}`, CHAIN_ID),
            getToken(tokenOutAddress as `0x${string}`, CHAIN_ID)
        ]);

        const trade = await quoteExactIn(tokenIn as Token, tokenOut as Token, BigInt(amount));

        if (!trade)
            return res
                .status(404)
                .json({ error: 'No route found – liquidity may be insufficient.' });

        const out = trade.outputAmount;

        res.json({
            quote: out.quotient.toString(),
            quoteDecimals: out.toExact(),
            tokenOutDecimals: out.currency.decimals,
            tokenOutSymbol: out.currency.symbol,
            route: trade.routes.map((p: any) => ({
                address: p.address,
                type: p.type
            })),
            type
        });
    } catch (e: any) {
        console.error(e);
        res.status(500).json({ error: e.message });
    }
});

const PORT = process.env.PORT ?? 3000;
app.listen(PORT, () => console.log(`Pancake SmartRouter quote API listening on ${PORT}`));