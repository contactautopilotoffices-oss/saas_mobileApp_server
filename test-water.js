const { createClient } = require('@supabase/supabase-js');
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://localhost:54321';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'dummy';
const admin = createClient(supabaseUrl, supabaseKey);

async function test() {
  const { data, error } = await admin.from('water_readings').select('quantity, computed_cost, reading_date, water_sources(source_type)').limit(1);
  console.log(JSON.stringify({ data, error }));
}
test();
