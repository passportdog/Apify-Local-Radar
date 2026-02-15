/**
 * Type definitions for Meta Ads Library Scraper
 */

export interface SearchQuery {
  keyword: string;
  location?: string;
}

export interface ProxyConfiguration {
  useApifyProxy?: boolean;
  apifyProxyGroups?: string[];
  proxyUrls?: string[];
}

export interface ActorInput {
  searchQueries: SearchQuery[];
  country: string;
  maxAdsPerQuery: number;
  adStatus: 'active' | 'inactive' | 'all';
  adType: 'all' | 'political_and_issue_ads' | 'housing_ads' | 'employment_ads' | 'credit_ads';
  mediaType: 'all' | 'image' | 'video' | 'meme' | 'none';
  scrapeAdDetails: boolean;
  proxyConfiguration: ProxyConfiguration;
  webhookUrl?: string;
  webhookBatchSize: number;
}

export interface MetaAd {
  // Identifiers
  ad_id: string;
  ad_archive_id?: string;
  ad_fingerprint: string; // Unique hash for deduplication
  
  // Page/Advertiser info
  page_id: string;
  page_name: string;
  page_profile_picture_url?: string;
  page_profile_uri?: string;
  page_categories?: string[];
  page_like_count?: number;
  
  // Ad content
  ad_text?: string;
  ad_creative_bodies?: string[];
  ad_creative_link_captions?: string[];
  ad_creative_link_titles?: string[];
  ad_creative_link_descriptions?: string[];
  cta_text?: string;
  cta_type?: string;
  
  // Media
  media_type?: 'image' | 'video' | 'carousel' | 'none';
  media_urls?: string[];
  thumbnail_url?: string;
  video_url?: string;
  
  // Delivery info
  ad_delivery_start_time?: string;
  ad_delivery_stop_time?: string;
  is_active: boolean;
  
  // Spend & reach (when available)
  currency?: string;
  spend_lower?: number;
  spend_upper?: number;
  impressions_lower?: number;
  impressions_upper?: number;
  
  // Targeting
  platforms?: string[];
  publisher_platforms?: string[];
  target_locations?: string[];
  target_ages?: string;
  target_gender?: string;
  demographic_distribution?: DemographicData[];
  
  // EU Transparency (if scrapeAdDetails enabled)
  eu_total_reach?: number;
  beneficiary_payers?: string[];
  
  // Metadata
  search_query: string;
  search_location?: string;
  scraped_at: string;
  source_url: string;
}

export interface DemographicData {
  age_range: string;
  gender: string;
  percentage: number;
}

export interface ScrapeResult {
  success: boolean;
  query: SearchQuery;
  adsFound: number;
  ads: MetaAd[];
  error?: string;
}

export interface WebhookPayload {
  actorRunId: string;
  batchNumber: number;
  totalBatches?: number;
  ads: MetaAd[];
  query: SearchQuery;
  timestamp: string;
}
