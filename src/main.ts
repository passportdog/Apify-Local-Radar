/**
 * Meta Ads Library Scraper - Main Entry Point
 * 
 * Optimized for Apify Creator Plan:
 * - Minimal memory usage (1GB default)
 * - Efficient proxy rotation
 * - Webhook support for Supabase integration
 * - Batch processing for large datasets
 */

import { Actor, log } from 'apify';
import { PlaywrightCrawler, ProxyConfiguration } from 'crawlee';
import { ActorInput, MetaAd, SearchQuery, WebhookPayload } from './types.js';
import { scrapeQuery, deduplicateAds, DeduplicationTracker } from './scraper.js';

// Constants for efficiency
const DEFAULT_MEMORY_MBYTES = 1024; // 1GB - minimize compute costs
const REQUESTS_PER_MINUTE = 10; // Conservative to avoid blocks
const MAX_CONCURRENT_REQUESTS = 2; // Balance speed vs resources

async function main() {
  await Actor.init();
  
  log.info('🚀 Meta Ads Library Scraper starting...');
  
  // Get input with defaults
  const input = await Actor.getInput<ActorInput>() ?? {
    searchQueries: [{ keyword: 'plumber', location: 'Ocala, FL' }],
    country: 'US',
    maxAdsPerQuery: 100,
    adStatus: 'active',
    adType: 'all',
    mediaType: 'all',
    scrapeAdDetails: false,
    proxyConfiguration: { useApifyProxy: true, apifyProxyGroups: ['RESIDENTIAL'] },
    webhookBatchSize: 50,
  };
  
  log.info(`Processing ${input.searchQueries.length} search queries`);
  log.info(`Max ads per query: ${input.maxAdsPerQuery}`);
  log.info(`Country: ${input.country}`);
  log.info(`Webhook: ${input.webhookUrl || 'Not configured'}`);
  
  // Setup proxy configuration
  let proxyConfiguration: ProxyConfiguration | undefined;
  
  if (input.proxyConfiguration?.useApifyProxy) {
    proxyConfiguration = new ProxyConfiguration({
      groups: input.proxyConfiguration.apifyProxyGroups || ['RESIDENTIAL'],
    });
    log.info('Using Apify Proxy with RESIDENTIAL group');
  } else if (input.proxyConfiguration?.proxyUrls?.length) {
    proxyConfiguration = new ProxyConfiguration({
      proxyUrls: input.proxyConfiguration.proxyUrls,
    });
    log.info('Using custom proxy URLs');
  }
  
  // Track all collected ads
  const allAds: MetaAd[] = [];
  let totalProcessed = 0;
  let batchNumber = 0;
  
  // Initialize deduplication tracker
  const dedupeTracker = new DeduplicationTracker();
  
  // Optional: Load existing fingerprints from Supabase to avoid re-scraping
  if (input.webhookUrl) {
    try {
      // Try to fetch existing fingerprints from a dedicated endpoint
      const checkUrl = input.webhookUrl.replace('/import-ads', '/get-fingerprints');
      const response = await fetch(checkUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          queries: input.searchQueries.map(q => q.keyword) 
        }),
      });
      
      if (response.ok) {
        const { fingerprints } = await response.json();
        if (fingerprints?.length > 0) {
          dedupeTracker.loadExisting(fingerprints);
          log.info(`📋 Loaded ${fingerprints.length} existing fingerprints for deduplication`);
        }
      }
    } catch (e) {
      log.debug('Could not load existing fingerprints (endpoint may not exist)');
    }
  }
  
  // Webhook helper
  async function sendWebhook(ads: MetaAd[], query: SearchQuery, isFinal = false) {
    if (!input.webhookUrl || ads.length === 0) return;
    
    batchNumber++;
    const payload: WebhookPayload = {
      actorRunId: Actor.getEnv().actorRunId || 'local',
      batchNumber,
      ads,
      query,
      timestamp: new Date().toISOString(),
    };
    
    try {
      const response = await fetch(input.webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Actor-Run-Id': Actor.getEnv().actorRunId || 'local',
          'X-Batch-Number': batchNumber.toString(),
          'X-Is-Final': isFinal.toString(),
        },
        body: JSON.stringify(payload),
      });
      
      if (!response.ok) {
        log.warning(`Webhook failed: ${response.status} ${response.statusText}`);
      } else {
        log.info(`✅ Webhook batch ${batchNumber} sent: ${ads.length} ads`);
      }
    } catch (error) {
      log.error(`Webhook error: ${error}`);
    }
  }
  
  // Create crawler with minimal resource usage
  const crawler = new PlaywrightCrawler({
    proxyConfiguration,
    
    // Memory optimization
    maxConcurrency: MAX_CONCURRENT_REQUESTS,
    maxRequestsPerMinute: REQUESTS_PER_MINUTE,
    
    // Browser configuration
    launchContext: {
      launchOptions: {
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--single-process', // Reduce memory
        ],
      },
    },
    
    // Use persistent browser context for session continuity
    browserPoolOptions: {
      useFingerprints: true, // Random fingerprints
      maxOpenPagesPerBrowser: 1, // One tab at a time
    },
    
    // Request handler
    requestHandler: async ({ page, request }) => {
      const query = request.userData.query as SearchQuery;
      
      log.info(`📍 Processing: ${query.keyword} ${query.location || ''}`);
      
      // Set realistic viewport
      await page.setViewportSize({ width: 1366, height: 768 });
      
      // Set language and locale headers
      await page.setExtraHTTPHeaders({
        'Accept-Language': 'en-US,en;q=0.9',
      });
      
      try {
        // Scrape this query
        const rawAds = await scrapeQuery(
          page,
          query,
          input.country,
          input.maxAdsPerQuery,
          input.adStatus,
          input.adType,
          input.mediaType
        );
        
        // Filter out duplicates using tracker
        const ads = rawAds.filter(ad => dedupeTracker.isNew(ad));
        const duplicatesSkipped = rawAds.length - ads.length;
        
        if (duplicatesSkipped > 0) {
          log.info(`🔄 Skipped ${duplicatesSkipped} duplicate ads`);
        }
        
        // Add to collection
        allAds.push(...ads);
        totalProcessed += ads.length;
        
        // Store each ad to dataset immediately (streaming)
        for (const ad of ads) {
          await Actor.pushData(ad);
        }
        
        log.info(`✅ Query complete: ${ads.length} ads (Total: ${totalProcessed})`);
        
        // Send webhook in batches
        if (input.webhookUrl && ads.length > 0) {
          const batches = [];
          for (let i = 0; i < ads.length; i += input.webhookBatchSize) {
            batches.push(ads.slice(i, i + input.webhookBatchSize));
          }
          
          for (const batch of batches) {
            await sendWebhook(batch, query);
          }
        }
        
      } catch (error) {
        log.error(`❌ Query failed: ${query.keyword} - ${error}`);
        
        // Store error for debugging
        await Actor.pushData({
          error: true,
          query,
          message: String(error),
          timestamp: new Date().toISOString(),
        });
      }
      
      // Small delay between queries (respectful scraping)
      await page.waitForTimeout(2000 + Math.random() * 3000);
    },
    
    // Retry failed requests
    maxRequestRetries: 3,
    
    // Error handling
    failedRequestHandler: async ({ request, error }) => {
      log.error(`Request failed after retries: ${request.url} - ${error}`);
    },
  });
  
  // Build request queue from search queries
  const requests = input.searchQueries.map((query, index) => ({
    url: `https://www.facebook.com/ads/library/?q=${encodeURIComponent(query.keyword)}`,
    uniqueKey: `query_${index}_${query.keyword}_${query.location || ''}`,
    userData: { query },
  }));
  
  // Run the crawler
  await crawler.run(requests);
  
  // Final deduplication (belt and suspenders)
  const uniqueAds = deduplicateAds(allAds);
  
  // Get deduplication stats
  const dedupeStats = dedupeTracker.stats;
  
  // Summary
  log.info('=' .repeat(50));
  log.info('📊 SCRAPING COMPLETE');
  log.info(`Total queries processed: ${input.searchQueries.length}`);
  log.info(`Total ads scraped: ${totalProcessed}`);
  log.info(`Duplicates skipped (in-run): ${dedupeStats.duplicates}`);
  log.info(`Unique ads saved: ${uniqueAds.length}`);
  log.info('=' .repeat(50));
  
  // Store summary in key-value store
  await Actor.setValue('SUMMARY', {
    queriesProcessed: input.searchQueries.length,
    totalAdsCollected: totalProcessed,
    uniqueAds: uniqueAds.length,
    completedAt: new Date().toISOString(),
    input: {
      country: input.country,
      maxAdsPerQuery: input.maxAdsPerQuery,
      adStatus: input.adStatus,
    },
  });
  
  await Actor.exit();
}

main().catch(async (error) => {
  log.error(`Actor failed: ${error}`);
  await Actor.exit(1);
});
