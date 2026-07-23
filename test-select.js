const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const envFile = fs.readFileSync('.env', 'utf-8');
const urlMatch = envFile.match(/NEXT_PUBLIC_SUPABASE_URL=(.+)/);
const keyMatch = envFile.match(/SUPABASE_SERVICE_ROLE_KEY=(.+)/);
const supabase = createClient(urlMatch[1].trim(), keyMatch[1].trim());

async function run() {
  const { data, error } = await supabase
    .from('sop_completions')
    .select('id, completed_by, user:users(id, full_name), completed_by_user:users!completed_by(id, full_name)')
    .limit(5);
  console.log('Result:', JSON.stringify(data, null, 2));
  if (error) console.error('Error:', error);
}
run();
