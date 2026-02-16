/**
 * Bright Data Scraper Studio - Parser Code
 * 
 * Paste this in the "Parser" tab of Scraper Studio
 */

// ============================================
// SCRAPER STUDIO PARSER CODE
// Paste this in the "Parser" tab
// ============================================

function parse(data) {
  // Transform to Meta Ad Library API format for your webhook
  const ads = data.ads || [];
  
  const transformedAds = ads.map(ad => ({
    id: ad.ad_id,
    page_id: ad.ad_id.split('_')[0] || 'unknown',
    page_name: ad.page_name,
    ad_snapshot_url: `https://www.facebook.com/ads/archive/render_ad/?id=${ad.ad_id}`,
    ad_creative_bodies: ad.ad_text ? [ad.ad_text] : [],
    ad_creative_link_captions: [],
    ad_creative_link_descriptions: [],
    ad_creative_link_titles: [],
    ad_delivery_start_time: ad.start_date || new Date().toISOString().split('T')[0],
    ad_delivery_stop_time: null,
    bylines: ad.page_name,
    currency: 'USD',
    delivery_by_region: [{ 
      region: data.location ? data.location.split(',')[0] : 'Florida', 
      percentage: '100' 
    }],
    demographic_distribution: null,
    estimated_audience_size: null,
    eu_total_reach: null,
    impressions: { lower_bound: '1000', upper_bound: '1999' },
    languages: ['en'],
    publisher_platforms: ['facebook', 'instagram'],
    spend: { lower_bound: '100', upper_bound: '199' },
    target_locations: [data.location || 'Florida'],
    target_gender: 'All',
    target_age: '18-65+',
    // Custom fields
    search_keyword: data.keyword,
    search_location: data.location,
    ads_found: data.ads_found,
    scraped_at: data.scraped_at,
    media_urls: ad.media_urls,
    media_type: ad.media_type,
  }));
  
  return {
    ads: transformedAds,
    defaults: {
      city: data.location ? data.location.split(',')[0] : '',
      state: 'Florida',
      industry: data.keyword,
    },
    search_term: data.search_term,
    ads_found: data.ads_found,
  };
}

// Scraper Studio automatically uses parse(data) as the entry point
// No module.exports needed - this is top-level code
