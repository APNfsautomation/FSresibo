// Replace these placeholders during the Supabase connection sprint. The browser must only use a publishable/anon key.
export const supabaseConfig = Object.freeze({
  url: 'https://ilinpznoawvsplkhjaqr.supabase.co',
  anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlsaW5wem5vYXd2c3Bsa2hqYXFyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUyOTcwMTgsImV4cCI6MjEwMDg3MzAxOH0.PuY2y68-z5mjllYvE5FE90uwbCWvs2YlEV0sf-5SA48'
});

let client;

export function isSupabaseConfigured() {
  return supabaseConfig.url !== 'YOUR_SUPABASE_URL' && supabaseConfig.anonKey !== 'YOUR_SUPABASE_ANON_KEY';
}

export async function getSupabaseClient() {
  if (!isSupabaseConfigured()) return null;
  if (client) return client;

  const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
  client = createClient(supabaseConfig.url, supabaseConfig.anonKey);
  return client;
}
