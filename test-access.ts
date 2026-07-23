import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://xvucakstcmtfoanmgcql.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function checkTickets() {
  const userId = '5fe04b2c-a77e-4d22-a95f-46836173f9ee';
  const propertyId = '4f0f44eb-5169-4c67-9d09-325016125a8d';

  console.log(`Checking tickets for user: ${userId} and property: ${propertyId}`);

  const { data: tickets, error } = await supabase
    .from('tickets')
    .select('id, title, status, assigned_to, raised_by, created_at')
    .eq('property_id', propertyId)
    .order('created_at', { ascending: false })
    .limit(30);

  if (error) {
    console.error('Error fetching tickets:', error);
    return;
  }

  const assigned = tickets.filter(t => t.assigned_to === userId || t.raised_by === userId);

  console.log(`Total latest 30 tickets for property: ${tickets.length}`);
  console.log(`Tickets associated with user in latest 30: ${assigned.length}`);
  console.log('Assigned tickets:', assigned);

  // Check total tickets for user
  const { count: totalUserTickets } = await supabase
    .from('tickets')
    .select('*', { count: 'exact', head: true })
    .eq('property_id', propertyId)
    .or(`assigned_to.eq.${userId},raised_by.eq.${userId}`);

  console.log(`Total tickets for user in DB: ${totalUserTickets}`);
}

checkTickets().catch(console.error);
