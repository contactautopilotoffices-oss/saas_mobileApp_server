const url = process.env.NEXT_PUBLIC_SUPABASE_URL + '/rest/v1/water_readings?select=quantity,computed_cost,reading_date,water_sources(source_type)&limit=1';
fetch(url, {
  headers: {
    'apikey': process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    'Authorization': 'Bearer ' + process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  }
}).then(res => res.text()).then(text => console.log('RESPONSE:', text)).catch(console.error);
