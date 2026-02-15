/**
 * Import Ads Edge Function
 * Receives ad batches from Apify Actor and stores them in Supabase
 * 
 * Features:
 * - Deduplication via UPSERT with ad_fingerprint
 * - Batch processing for efficiency
 * - Error handling with detailed responses
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-actor-run-id, x-batch-number, x-is-final',
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
    
    const payload = await req.json()
    const { ads, query, batchNumber, actorRunId } = payload
    
    if (!ads || !Array.isArray(ads)) {
      return new Response(
        JSON.stringify({ error: 'Invalid payload: ads array required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }
    
    console.log(`📥 Batch ${batchNumber}: Received ${ads.length} ads for "${query?.keyword || 'unknown'}"`)
    console.log(`   Actor Run: ${actorRunId}`)
    
    // Transform ads to match our schema
    const transformedAds = ads.map((ad: any) => ({
      ad_fingerprint: ad.ad_fingerprint,
      external_id: ad.ad_id,
      ad_archive_id: ad.ad_archive_id,
      platform: 'meta',
      advertiser_id: ad.page_id,
      advertiser_name: ad.page_name,
      advertiser_profile_url: ad.page_profile_uri,
      advertiser_profile_image: ad.page_profile_picture_url,
      ad_text: ad.ad_text,
      ad_bodies: ad.ad_creative_bodies,
      link_title: ad.ad_creative_link_titles?.[0],
      link_caption: ad.ad_creative_link_captions?.[0],
      link_description: ad.ad_creative_link_descriptions?.[0],
      cta_text: ad.cta_text,
      media_type: ad.media_type,
      media_urls: ad.media_urls,
      is_active: ad.is_active,
      started_at: ad.ad_delivery_start_time ? new Date(ad.ad_delivery_start_time).toISOString() : null,
      stopped_at: ad.ad_delivery_stop_time ? new Date(ad.ad_delivery_stop_time).toISOString() : null,
      currency: ad.currency,
      spend_lower: ad.spend_lower,
      spend_upper: ad.spend_upper,
      impressions_lower: ad.impressions_lower,
      impressions_upper: ad.impressions_upper,
      platforms: ad.platforms,
      publisher_platforms: ad.publisher_platforms,
      target_locations: ad.target_locations,
      eu_total_reach: ad.eu_total_reach,
      search_query: ad.search_query,
      search_location: ad.search_location,
      source_url: ad.source_url,
      scraped_at: ad.scraped_at,
      raw_data: ad,
    }))
    
    // Upsert with conflict handling on ad_fingerprint
    // ON CONFLICT DO UPDATE ensures we get latest data if ad already exists
    const { data, error, count } = await supabase
      .from('ads')
      .upsert(transformedAds, {
        onConflict: 'ad_fingerprint',
        ignoreDuplicates: false, // Update existing records
      })
      .select('id, ad_fingerprint')
    
    if (error) {
      console.error('❌ Upsert error:', error)
      return new Response(
        JSON.stringify({ 
          error: error.message,
          code: error.code,
          details: error.details 
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }
    
    // Count new vs updated
    const insertedCount = data?.length || 0
    
    console.log(`✅ Batch ${batchNumber}: Processed ${insertedCount} ads`)
    
    return new Response(
      JSON.stringify({
        success: true,
        batch: batchNumber,
        received: ads.length,
        processed: insertedCount,
        query: query?.keyword,
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
