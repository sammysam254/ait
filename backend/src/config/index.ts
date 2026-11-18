import dotenv from 'dotenv';
import path from 'path';

// Load .env from backend or root
dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(process.cwd(), '../.env') });

export const config = {
  port: parseInt(process.env.PORT || '4000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  jwtSecret: process.env.JWT_SECRET || 'vertex-saas-super-secure-jwt-secret-key-32-chars-min',
  encryptionKey: process.env.ENCRYPTION_KEY || 'vertex-encryption-key-32-chars-long!',
  
  // Supabase Configuration
  supabaseUrl: process.env.SUPABASE_URL || 'https://hmfshxxmraxrdgmkpwvo.supabase.co',
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY || '',
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  supabaseDbConnectionString: process.env.SUPABASE_DB_CONNECTION_STRING || '',

  // Cloudflare Tunnel Configuration
  cloudflare: {
    apiToken: process.env.CLOUDFLARE_API_TOKEN || '',
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID || '213c27cb095ce0e114e3d5f3d3782b5d',
    zoneId: process.env.CLOUDFLARE_ZONE_ID || 'fbc764e84d8895b66b1f59ed42bdd3df',
    domain: process.env.CLOUDFLARE_DOMAIN || 'sam.co.ke',
  },

  // URLs
  backendUrl: process.env.BACKEND_URL || 'https://vertextstreams.sam.co.ke',
  frontendUrl: process.env.FRONTEND_URL || 'https://vertextstreams.sam.co.ke',
};
