/**
 * Get Fingerprints Edge Function
 * Returns existing ad fingerprints to allow Actor to skip duplicates
 * 
 * This prevents re-scraping ads that are already in the database
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  
  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )
    
    const { queries, location, maxAge } = await req.json()
    
    console.log(`📋 Fetching fingerprints for queries: ${queries?.join(', ') || 'all'}`)
    
    // Build query
    let query = supabase
      .from('ads')
      .select('ad_fingerprint')
    
    // Filter by search queries if provided
    if (queries && queries.length > 0) {
      query = query.in('search_query', queries)
    }
    
    // Filter by location if provided
    if (location) {
      query = query.eq('search_location', location)
    }
    
    // Filter by max age (days) if provided - only get recent ads
    if (maxAge) {
      const cutoff = new Date()
      cutoff.setDate(cutoff.getDate() - maxAge)
      query = query.gte('scraped_at', cutoff.toISOString())
    }
    
    // Limit to prevent huge responses
    query = query.limit(50000)
    
    const { data, error } = await query
    
    if (error) {
      console.error('❌ Query error:', error)
      return new Response(
        JSON.stringify({ error: error.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }
    
    const fingerprints = data?.map(row => row.ad_fingerprint) || []
    
    console.log(`✅ Returning ${fingerprints.length} existing fingerprints`)
    
    return new Response(
      JSON.stringify({
        fingerprints,
        count: fingerprints.length,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
    
  } catch (error) {
    console.error('❌ Unexpected error:', error)
    return new Response(
      JSON.stringify({ error: String(error) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
