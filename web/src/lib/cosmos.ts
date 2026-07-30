import { CosmosClient } from '@azure/cosmos';
import { ManagedIdentityCredential, AzureCliCredential, ChainedTokenCredential, TokenCredential } from '@azure/identity';

// Lazy singleton — first call after runtime env is available initializes the client.
// Never touched during `next build` "Collecting page data" because callers only invoke it
// inside request handlers.

let cachedClient: CosmosClient | null = null;

const REQUIRED_ENV_VARS = [
  'AZURE_COSMOSDB_ACCOUNT',
  'AZURE_COSMOSDB_DATABASE',
];

export function getCosmosClient(): CosmosClient {
  if (cachedClient) return cachedClient;

  const missing = REQUIRED_ENV_VARS.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  // Explicit chain instead of DefaultAzureCredential to avoid its browser-detection path
  // (which mis-fires under Next.js SSR bundling and throws
  // "DefaultAzureCredential is not supported in the browser").
  //   ACA runtime → ManagedIdentityCredential(AZURE_CLIENT_ID = UAMI clientId)
  //   local dev   → AzureCliCredential (upn needs Cosmos Data Contributor role)
  const chain: TokenCredential[] = [];
  if (process.env.AZURE_CLIENT_ID) {
    chain.push(new ManagedIdentityCredential(process.env.AZURE_CLIENT_ID));
  }
  chain.push(new AzureCliCredential());
  const credential = new ChainedTokenCredential(...chain);

  cachedClient = new CosmosClient({
    endpoint: `https://${process.env.AZURE_COSMOSDB_ACCOUNT}.documents.azure.com:443/`,
    aadCredentials: credential,
  });

  return cachedClient;
}
