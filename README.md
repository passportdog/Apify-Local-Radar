# Meta Ads Library Scraper

High-efficiency Facebook/Meta Ad Library scraper built for Local Radar. Optimized for Apify Creator Plan to maximize the $500 credit bonus.

## Features

- 🔍 **Multi-query support** - Scrape multiple keywords and locations in one run
- 🌍 **Location targeting** - Filter ads by country and location
- 📊 **Full ad data extraction** - Creative text, media, spend, impressions, platforms
- 🔄 **Webhook integration** - Stream results directly to Supabase
- 💰 **Cost optimized** - Uses minimal memory (1GB) to reduce compute costs
- 🛡️ **Residential proxy support** - Avoid blocks with Apify's residential IPs
- 🚫 **3-Layer Deduplication** - Never store duplicate ads

## Deduplication System

The scraper uses a 3-layer deduplication system:

```
┌─────────────────────────────────────────────────────────────────┐
│  LAYER 1: In-Actor                                              │
│  • Fingerprints each ad: page_id + ad_text + media_url         │
│  • Skips duplicates within same run                            │
├─────────────────────────────────────────────────────────────────┤
│  LAYER 2: Pre-Scrape Check                                      │
│  • Fetches existing fingerprints from Supabase                 │
│  • Skips ads already in database                               │
├─────────────────────────────────────────────────────────────────┤
│  LAYER 3: Database Constraint                                   │
│  • UNIQUE constraint on ad_fingerprint column                  │
│  • UPSERT prevents duplicates, updates existing                │
└─────────────────────────────────────────────────────────────────┘
```

## Cost Efficiency

| Resource | Usage | Cost |
|----------|-------|------|
| Compute | ~0.05 CU per query | ~$0.015/query |
| Proxy | ~0.5MB per query | ~$0.005/query |
| **Per 1000 ads** | ~20 queries | **~$0.40** |

With $500 credits, you can scrape approximately **1.25 million ads**.

## Quick Start

### 1. On Apify Console

1. Go to [Apify Console](https://console.apify.com)
2. Create new Actor from GitHub
3. Link this repository
4. Configure input and run

### 2. Input Configuration

```json
{
  "searchQueries": [
    { "keyword": "plumber", "location": "Ocala, FL" },
    { "keyword": "hvac", "location": "Ocala, FL" },
    { "keyword": "electrician", "location": "Gainesville, FL" }
  ],
  "country": "US",
  "maxAdsPerQuery": 100,
  "adStatus": "active",
  "adType": "all",
  "mediaType": "all",
  "proxyConfiguration": {
    "useApifyProxy": true,
    "apifyProxyGroups": ["RESIDENTIAL"]
  },
  "webhookUrl": "https://your-project.supabase.co/functions/v1/import-ads"
}
```

### 3. Webhook Integration (Supabase)

The actor sends batches of ads to your webhook URL. Create a Supabase Edge Function to receive them:

```typescript
// supabase/functions/import-ads/index.ts
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

serve(async (req) => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )
  
  const payload = await req.json()
  const { ads, query, batchNumber } = payload
  
  console.log(`Received batch ${batchNumber}: ${ads.length} ads for "${query.keyword}"`)
  
  // Insert ads into your database
  const { error } = await supabase
    .from('ads')
    .upsert(ads.map(ad => ({
      external_id: ad.ad_id,
      platform: 'meta',
      advertiser_name: ad.page_name,
      advertiser_id: ad.page_id,
      ad_text: ad.ad_text,
      media_type: ad.media_type,
      media_urls: ad.media_urls,
      spend_lower: ad.spend_lower,
      spend_upper: ad.spend_upper,
      impressions_lower: ad.impressions_lower,
      impressions_upper: ad.impressions_upper,
      platforms: ad.platforms,
      started_at: ad.ad_delivery_start_time,
      search_query: ad.search_query,
      search_location: ad.search_location,
      raw_data: ad,
    })), {
      onConflict: 'external_id'
    })
  
  if (error) {
    console.error('Insert error:', error)
    return new Response(JSON.stringify({ error: error.message }), { status: 500 })
  }
  
  return new Response(JSON.stringify({ 
    success: true, 
    inserted: ads.length 
  }))
})
```

## Supabase Setup (Complete)

The project includes production-ready Supabase components:

### 1. Run the Migration

```bash
# Apply the migration to your database
psql -h YOUR_DB_HOST -U postgres -d postgres < supabase/migrations/001_create_ads_table.sql
```

Or copy-paste the SQL from `supabase/migrations/001_create_ads_table.sql` into Supabase SQL Editor.

This creates:
- `ads` table with UNIQUE constraint on `ad_fingerprint`
- Indexes for fast queries by advertiser, location, platform
- `ads_stats` view for quick analytics
- Auto-updating `updated_at` trigger

### 2. Deploy Edge Functions

```bash
# From your project root
cd supabase

# Deploy both functions
supabase functions deploy import-ads
supabase functions deploy get-fingerprints
```

### 3. Configure Actor Webhook

Set `webhookUrl` in your Actor input:
```json
{
  "webhookUrl": "https://YOUR-PROJECT.supabase.co/functions/v1/import-ads"
}
```

The Actor will automatically:
1. Call `get-fingerprints` to check existing ads
2. Skip ads already in database (saves compute credits!)
3. Send only NEW ads to `import-ads`
4. UPSERT with fingerprint prevents any duplicates
```

## Output Schema

Each ad in the dataset contains:

```typescript
{
  ad_id: string;              // Unique identifier
  ad_fingerprint: string;     // Deduplication hash
  page_id: string;            // Facebook page ID
  page_name: string;          // Advertiser name
  page_profile_picture_url: string;
  page_profile_uri: string;
  
  ad_text: string;            // Primary ad text
  ad_creative_bodies: string[];
  ad_creative_link_titles: string[];
  cta_text: string;
  
  media_type: 'image' | 'video' | 'carousel' | 'none';
  media_urls: string[];
  
  ad_delivery_start_time: string;
  is_active: boolean;
  
  currency: string;
  spend_lower: number;        // Minimum estimated spend
  spend_upper: number;        // Maximum estimated spend
  impressions_lower: number;
  impressions_upper: number;
  
  platforms: string[];        // ['facebook', 'instagram', etc.]
  
  search_query: string;       // Original search keyword
  search_location: string;    // Original search location
  scraped_at: string;         // ISO timestamp
  source_url: string;         // Ad Library URL
}
```

## Local Development

```bash
# Install dependencies
npm install

# Run locally with test input
npm run dev

# Build for production
npm run build
```

## Proxy Configuration

For best results, use **residential proxies** to avoid Facebook blocks:

```json
{
  "proxyConfiguration": {
    "useApifyProxy": true,
    "apifyProxyGroups": ["RESIDENTIAL"]
  }
}
```

**Note:** Creator Plan includes 10GB/month residential proxy. Each query uses ~0.3-0.5MB, so 10GB = ~25,000+ queries.

## Rate Limits

The actor uses conservative rate limiting to avoid detection:

- 10 requests per minute
- 2 concurrent browsers
- 2-5 second delay between queries
- Random delays during scrolling

## Troubleshooting

### "Blocked by Facebook"

- Ensure you're using RESIDENTIAL proxy group
- Reduce `maxAdsPerQuery` to 50
- Add delays between runs

### "No ads found"

- Check if the keyword exists in Ad Library
- Try different location
- Verify country code is correct

### Memory issues

- Default 1GB is sufficient for most queries
- For very large queries (500+ ads), consider 2GB

## License

MIT - Built for Local Radar

## Support

Issues? Create a GitHub issue or contact support.
