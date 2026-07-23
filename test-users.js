const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const envFile = fs.readFileSync('.env', 'utf-8');
const urlMatch = envFile.match(/NEXT_PUBLIC_SUPABASE_URL=(.+)/);
const keyMatch = envFile.match(/SUPABASE_SERVICE_ROLE_KEY=(.+)/);
const supabase = createClient(urlMatch[1].trim(), keyMatch[1].trim());

async function run() {
  const { data: completions, error } = await supabase
    .from('sop_completions')
    .select('id, completed_by, user:users(id, full_name, email)')
    .eq('status', 'completed')
    .limit(20);
    
  console.log('Result:', JSON.stringify(completions, null, 2));
  if (error) console.error('Error:', error);
}
run();
