import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
// Use SERVICE_ROLE_KEY for server-side bot (bypasses RLS, full admin access)
// Falls back to ANON_KEY if SERVICE_ROLE_KEY not set (for compatibility)
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Supabase credentials not found in environment variables');
  console.error('Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env file');
  console.error('\n📋 Required:');
  console.error('   • SUPABASE_URL - Your Supabase project URL');
  console.error('   • SUPABASE_SERVICE_ROLE_KEY - Admin key (recommended for bots)');
  console.error('     OR SUPABASE_ANON_KEY - Public key (limited permissions)');
  process.exit(1);
}

// Log which key is being used
const keyType = process.env.SUPABASE_SERVICE_ROLE_KEY ? 'SERVICE_ROLE (admin)' : 'ANON (public)';
console.log(`🔑 Using Supabase ${keyType} key`);

export const supabase = createClient(supabaseUrl, supabaseKey);

// Test connection
export async function testConnection() {
  try {
    const { error } = await supabase.from('games').select('id').limit(1);
    if (error && error.code !== 'PGRST116') { // PGRST116 = table doesn't exist yet
      console.warn('⚠️  Supabase connection warning:', error.message);
      return false;
    }
    console.log('✅ Supabase connected successfully');
    return true;
  } catch (err) {
    console.error('❌ Supabase connection failed:', err);
    return false;
  }
}
