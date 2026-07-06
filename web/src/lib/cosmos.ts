import { CosmosClient } from '@azure/cosmos';
import { ClientSecretCredential } from '@azure/identity';

// Lazy singleton — first call after runtime env is available initializes the client.
// Never touched during `next build` "Collecting page data" because callers only invoke it
// inside request handlers.

let cachedClient: CosmosClient | null = null;

const REQUIRED_ENV_VARS = [
  'APP_TENANT_ID',
  'APP_CLIENT_ID',
  'APP_CLIENT_SECRET',
  'AZURE_COSMOSDB_ACCOUNT',
  'AZURE_COSMOSDB_DATABASE',
];

export function getCosmosClient(): CosmosClient {
  if (cachedClient) return cachedClient;

  const missing = REQUIRED_ENV_VARS.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  const credential = new ClientSecretCredential(
    process.env.APP_TENANT_ID!,
    process.env.APP_CLIENT_ID!,
    process.env.APP_CLIENT_SECRET!,
  );

  cachedClient = new CosmosClient({
    endpoint: `https://${process.env.AZURE_COSMOSDB_ACCOUNT}.documents.azure.com:443/`,
    aadCredentials: credential,
  });

  return cachedClient;
}
