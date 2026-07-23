const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const envFile = fs.readFileSync('.env', 'utf-8');
const urlMatch = envFile.match(/NEXT_PUBLIC_SUPABASE_URL=(.+)/);
const keyMatch = envFile.match(/SUPABASE_SERVICE_ROLE_KEY=(.+)/) || envFile.match(/NEXT_PUBLIC_SUPABASE_ANON_KEY=(.+)/);

const supabase = createClient(urlMatch[1].trim(), keyMatch[1].trim());

async function run() {
  const { data: completions } = await supabase
    .from('sop_completions')
    .select('id, completed_by, items:sop_completion_items(checked_by)')
    .eq('status', 'completed')
    .is('completed_by', null);
  
  if (!completions) return console.log('No completions to fix');
  console.log(`Found ${completions.length} completed checklists missing completed_by`);
  
  let fixedCount = 0;
  for (const c of completions) {
    const validItems = c.items.filter(i => i.checked_by);
    if (validItems.length > 0) {
      const lastUser = validItems[validItems.length - 1].checked_by;
      await supabase.from('sop_completions').update({ completed_by: lastUser }).eq('id', c.id);
      fixedCount++;
    }
  }
  console.log(`Successfully fixed ${fixedCount} checklists by looking at their checked items!`);
}

run();
