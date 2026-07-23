const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const envFile = fs.readFileSync('.env', 'utf-8');
const urlMatch = envFile.match(/NEXT_PUBLIC_SUPABASE_URL=(.+)/);
const keyMatch = envFile.match(/SUPABASE_SERVICE_ROLE_KEY=(.+)/);
const supabase = createClient(urlMatch[1].trim(), keyMatch[1].trim());

async function run() {
  const { data: completions, error } = await supabase
    .from('sop_completions')
    .select('id, property_id')
    .eq('status', 'completed')
    .is('completed_by', null);
    
  if (error) return console.error('Error:', error);
  if (!completions || completions.length === 0) return console.log('No unknown completions left.');

  console.log(`Found ${completions.length} unknown completions.`);

  for (const c of completions) {
    // find an admin for this property
    const { data: members } = await supabase
      .from('property_memberships')
      .select('user_id')
      .eq('property_id', c.property_id)
      .limit(1);
    
    const userId = members && members.length > 0 ? members[0].user_id : 'ea86aff2-b7f3-44b5-94b1-838eea2b0fea';
    
    await supabase.from('sop_completions').update({ completed_by: userId }).eq('id', c.id);
  }
  
  console.log(`Updated ${completions.length} completions to valid users.`);
}
run();
