-- Migration: Create ads table with deduplication
-- Run this on your Supabase database

-- Create ads table with fingerprint for deduplication
CREATE TABLE IF NOT EXISTS ads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Deduplication key (UNIQUE constraint prevents duplicates)
  ad_fingerprint TEXT NOT NULL,
  
  -- External identifiers
  external_id TEXT,
  ad_archive_id TEXT,
  
  -- Platform info
  platform TEXT NOT NULL DEFAULT 'meta',
  
  -- Advertiser info
  advertiser_id TEXT,
  advertiser_name TEXT NOT NULL,
  advertiser_profile_url TEXT,
  advertiser_profile_image TEXT,
  advertiser_page_likes INTEGER,
  
  -- Ad content
  ad_text TEXT,
  ad_bodies TEXT[], -- Array of all text variations
  link_title TEXT,
  link_caption TEXT,
  link_description TEXT,
  cta_text TEXT,
  cta_type TEXT,
  
  -- Media
  media_type TEXT, -- 'image', 'video', 'carousel', 'none'
  media_urls TEXT[],
  thumbnail_url TEXT,
  
  -- Delivery info
  is_active BOOLEAN DEFAULT true,
  started_at TIMESTAMPTZ,
  stopped_at TIMESTAMPTZ,
  
  -- Spend & reach (when available)
  currency TEXT,
  spend_lower NUMERIC,
  spend_upper NUMERIC,
  impressions_lower BIGINT,
  impressions_upper BIGINT,
  
  -- Targeting
  platforms TEXT[], -- ['facebook', 'instagram', etc.]
  publisher_platforms TEXT[],
  target_locations TEXT[],
  target_ages TEXT,
  target_gender TEXT,
  
  -- EU Transparency
  eu_total_reach BIGINT,
  
  -- Search context (how we found this ad)
  search_query TEXT,
  search_location TEXT,
  source_url TEXT,
  
  -- Raw data for reference
  raw_data JSONB,
  
  -- Timestamps
  scraped_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  
  -- UNIQUE constraint on fingerprint prevents duplicates
  CONSTRAINT ads_fingerprint_unique UNIQUE (ad_fingerprint)
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_ads_advertiser_name ON ads(advertiser_name);
CREATE INDEX IF NOT EXISTS idx_ads_advertiser_id ON ads(advertiser_id);
CREATE INDEX IF NOT EXISTS idx_ads_platform ON ads(platform);
CREATE INDEX IF NOT EXISTS idx_ads_search_query ON ads(search_query);
CREATE INDEX IF NOT EXISTS idx_ads_search_location ON ads(search_location);
CREATE INDEX IF NOT EXISTS idx_ads_scraped_at ON ads(scraped_at DESC);
CREATE INDEX IF NOT EXISTS idx_ads_is_active ON ads(is_active);
CREATE INDEX IF NOT EXISTS idx_ads_fingerprint ON ads(ad_fingerprint);

-- Full text search index
CREATE INDEX IF NOT EXISTS idx_ads_text_search ON ads 
  USING GIN (to_tsvector('english', COALESCE(ad_text, '') || ' ' || COALESCE(advertiser_name, '')));

-- Trigger to update updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ads_updated_at ON ads;
CREATE TRIGGER ads_updated_at
  BEFORE UPDATE ON ads
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- View for quick stats
CREATE OR REPLACE VIEW ads_stats AS
SELECT 
  platform,
  search_location,
  COUNT(*) as total_ads,
  COUNT(DISTINCT advertiser_id) as unique_advertisers,
  COUNT(*) FILTER (WHERE is_active) as active_ads,
  AVG(spend_upper) as avg_spend_upper,
  MAX(scraped_at) as last_scraped
FROM ads
GROUP BY platform, search_location;

-- Function to check for existing fingerprints (used by Actor)
CREATE OR REPLACE FUNCTION get_existing_fingerprints(query_keywords TEXT[])
RETURNS TABLE(fingerprint TEXT) AS $$
BEGIN
  RETURN QUERY
  SELECT DISTINCT ad_fingerprint
  FROM ads
  WHERE search_query = ANY(query_keywords)
  LIMIT 10000; -- Cap to prevent huge responses
END;
$$ LANGUAGE plpgsql;

-- Grant permissions (adjust based on your setup)
-- GRANT ALL ON ads TO authenticated;
-- GRANT ALL ON ads TO service_role;
