require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

async function test() {
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  
  const orgId = '211e1330-ad83-446d-941f-dcea48396798';
  console.log(`Looking for properties in org: ${orgId}`);
  
  const { data: props } = await admin.from('properties').select('id, name').eq('organization_id', orgId);
  console.log('Properties:', props);
  
  if (props && props.length > 0) {
    const { data: mems } = await admin.from('property_memberships')
      .select('user_id, property_id, role, is_active')
      .in('property_id', props.map(p => p.id));
      
    console.log('Memberships:', mems);
  }
}

test();
