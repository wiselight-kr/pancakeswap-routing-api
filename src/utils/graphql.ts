import { ChainId, STABLESWAP_SUBGRAPHS, V2_SUBGRAPHS, V3_SUBGRAPHS } from '@pancakeswap/chains'
import { GraphQLClient } from 'graphql-request'

export const THE_GRAPH_PROXY_API = 'https://thegraph.pancakeswap.com'

export const V2_SUBGRAPH_URLS = {
  ...V2_SUBGRAPHS,
  [ChainId.POLYGON_ZKEVM]: `${THE_GRAPH_PROXY_API}/exchange-v2-polygon-zkevm`,
  [ChainId.BASE]: `${THE_GRAPH_PROXY_API}/exchange-v2-base`,
  [ChainId.ETHEREUM]: `${THE_GRAPH_PROXY_API}/exchange-v2-eth`,
  [ChainId.BSC]: `${THE_GRAPH_PROXY_API}/exchange-v2-bsc`,
}

export const V3_SUBGRAPH_URLS = {
  ...V3_SUBGRAPHS,
  [ChainId.POLYGON_ZKEVM]: `${THE_GRAPH_PROXY_API}/exchange-v3-polygon-zkevm`,
  [ChainId.BASE]: `${THE_GRAPH_PROXY_API}/exchange-v3-base`,
  [ChainId.ETHEREUM]: `${THE_GRAPH_PROXY_API}/exchange-v3-eth`,
  [ChainId.BSC]: `${THE_GRAPH_PROXY_API}/exchange-v3-bsc`,
  [ChainId.ARBITRUM_ONE]: `${THE_GRAPH_PROXY_API}/exchange-v3-arb`,
  [ChainId.ZKSYNC]: `${THE_GRAPH_PROXY_API}/exchange-v3-zksync`,
  [ChainId.LINEA]: `${THE_GRAPH_PROXY_API}/exchange-v3-linea`,
  [ChainId.OPBNB]: `${THE_GRAPH_PROXY_API}/exchange-v3-opbnb`,
}

export const V3_BSC_INFO_CLIENT = `https://open-platform.nodereal.io/${
    process.env.NEXT_PUBLIC_NODE_REAL_API_INFO || process.env.NEXT_PUBLIC_NODE_REAL_API_ETH
}/pancakeswap-v3/graphql`

export const STABLESWAP_SUBGRAPHS_URLS = {
  ...STABLESWAP_SUBGRAPHS,
  [ChainId.BSC]: `${THE_GRAPH_PROXY_API}/exchange-stableswap-bsc`,
  [ChainId.ARBITRUM_ONE]: `${THE_GRAPH_PROXY_API}/exchange-stableswap-arb`,
  [ChainId.ETHEREUM]: `${THE_GRAPH_PROXY_API}/exchange-stableswap-eth`,
}

export const infoClient = new GraphQLClient(V2_SUBGRAPH_URLS[ChainId.BSC])

export const v3Clients = new GraphQLClient(V3_SUBGRAPH_URLS[ChainId.BSC])

export const v2Clients = new GraphQLClient(V2_SUBGRAPH_URLS[ChainId.BSC])