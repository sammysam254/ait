import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://hmfshxxmraxrdgmkpwvo.supabase.co';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhtZnNoeHhtcmF4cmRnbWtwd3ZvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTUwMTIwNDUsImV4cCI6MjExMDU4ODA0NX0.a1CmJ4CuxZpPTeBx4GHcth1uUhYyLbTRnxmWQ6L7yvo';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
